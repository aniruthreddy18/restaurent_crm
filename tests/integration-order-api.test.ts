/**
 * The n8n + PhonePe integration contract: POST /api/orders with a flat,
 * single-product payload, and GET /api/customers/phone/:phone.
 *
 * These exercise the service layer the routes delegate to, plus the schema the
 * routes validate with, so the contract cannot drift without a failing test.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { integrationOrderSchema } from "@/server/modules/orders/order.schema";
import { recordPaymentResult } from "@/server/modules/payments/payment.service";
import { findCustomerByPhone } from "@/server/modules/customers/customer.service";
import { BusinessRuleError } from "@/server/core/errors";
import { createTenant, resetDatabase, type Tenant } from "./helpers";

let tenant: Tenant;

/** Exactly the body n8n posts after a PhonePe callback. */
function phonePePayload(overrides: Record<string, unknown> = {}) {
  return {
    phone: "+91 90000 55555",
    customerName: "Aarti Desai",
    orderId: "ORD-COOKIE-1001",
    cookieType: "Double Chocolate Chip",
    quantity: 12,
    toppings: ["Sea salt", "Walnuts"],
    deliveryDate: "2026-09-20T10:00:00.000Z",
    totalPrice: 1440,
    paymentStatus: "SUCCESS",
    paymentTransactionId: "T2409121234567890",
    paidAt: "2026-09-12T12:00:00.000Z",
    gateway: "phonepe",
    paymentMethod: "UPI",
    ...overrides,
  };
}

/** Mirrors what the route does with a validated body. */
async function submit(body: Record<string, unknown>) {
  const parsed = integrationOrderSchema.parse(body);
  const toppings =
    typeof parsed.toppings === "string"
      ? parsed.toppings.split(",").map((t) => t.trim()).filter(Boolean)
      : (parsed.toppings ?? []);
  const quantity = parsed.quantity ?? 1;

  return recordPaymentResult(tenant.ctx, {
    transactionId: parsed.paymentTransactionId!,
    status: parsed.paymentStatus as "SUCCESS" | "FAILED",
    amount: parsed.totalPrice ?? 0,
    currency: parsed.currency,
    paymentMethod: parsed.paymentMethod,
    gateway: parsed.gateway,
    paidAt: parsed.paidAt,
    whatsappNumber: parsed.phone!,
    customer: parsed.customerName ? { name: parsed.customerName } : undefined,
    items: [
      {
        name: parsed.cookieType!,
        price: (parsed.totalPrice ?? 0) / quantity,
        quantity,
        modifiers: toppings.length ? toppings : undefined,
        notes: toppings.length ? toppings.join(", ") : undefined,
      },
    ],
    deliveryAddress: parsed.deliveryAddress,
    externalOrderId: parsed.orderId,
    scheduledFor: parsed.deliveryDate,
    totalAmount: parsed.totalPrice,
    externalEventId: parsed.orderId ? `ORDER:${parsed.orderId}` : undefined,
  });
}

beforeEach(async () => {
  await resetDatabase();
  tenant = await createTenant();
});

describe("payload validation", () => {
  it("accepts the documented PhonePe payload", () => {
    expect(integrationOrderSchema.safeParse(phonePePayload()).success).toBe(true);
  });

  it("requires a transaction id once the payment is terminal", () => {
    const result = integrationOrderSchema.safeParse(phonePePayload({ paymentTransactionId: undefined }));
    expect(result.success).toBe(false);
  });

  it("requires either a customerId or a phone", () => {
    const result = integrationOrderSchema.safeParse(phonePePayload({ phone: undefined }));
    expect(result.success).toBe(false);
  });

  it("requires something to order", () => {
    const result = integrationOrderSchema.safeParse(phonePePayload({ cookieType: undefined }));
    expect(result.success).toBe(false);
  });

  it("takes toppings as an array or a comma-separated string", () => {
    expect(integrationOrderSchema.safeParse(phonePePayload({ toppings: "Sea salt, Walnuts" })).success).toBe(true);
    expect(integrationOrderSchema.safeParse(phonePePayload({ toppings: [] })).success).toBe(true);
  });
});

describe("a successful PhonePe order", () => {
  it("creates the customer, order, line and payment in one call", async () => {
    const result = await submit(phonePePayload());

    expect(result.customerCreated).toBe(true);
    expect(result.orderStatus).toBe("CONFIRMED");
    expect(result.paymentStatus).toBe("SUCCESS");

    const customer = await prisma.customer.findFirstOrThrow();
    expect(customer.whatsappNumber).toBe("919000055555");
    expect(customer.name).toBe("Aarti Desai");

    const order = await prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.externalOrderId).toBe("ORD-COOKIE-1001");
    expect(order.totalAmount.toString()).toBe("1440");
    expect(order.scheduledFor?.toISOString()).toBe("2026-09-20T10:00:00.000Z");

    const line = order.items[0];
    expect(line.productNameSnapshot).toBe("Double Chocolate Chip");
    expect(line.quantity).toBe(12);
    expect(line.unitPriceSnapshot.toString()).toBe("120");
    expect(line.modifiers).toEqual(["Sea salt", "Walnuts"]);

    const payment = await prisma.payment.findFirstOrThrow();
    expect(payment.transactionId).toBe("T2409121234567890");
    expect(payment.gateway).toBe("phonepe");
    expect(payment.paidAt).not.toBeNull();
  });

  it("emits the events n8n needs for the WhatsApp confirmation", async () => {
    await submit(phonePePayload());
    const types = (await prisma.event.findMany()).map((e) => e.type);
    expect(types).toContain("CUSTOMER_CREATED");
    expect(types).toContain("PAYMENT_SUCCESS");
    expect(types).toContain("ORDER_CONFIRMED");
  });
});

describe("duplicate PhonePe callbacks", () => {
  it("does not create a second order when the same orderId arrives again", async () => {
    const first = await submit(phonePePayload());
    const second = await submit(phonePePayload());
    const third = await submit(phonePePayload());

    expect(second.orderId).toBe(first.orderId);
    expect(third.orderId).toBe(first.orderId);

    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.orderItem.count()).toBe(1);
  });

  it("de-duplicates on orderId even when the gateway retries with a new transaction id", async () => {
    const first = await submit(phonePePayload());
    // PhonePe retried and issued a fresh transaction reference for the same order.
    const retry = await submit(phonePePayload({ paymentTransactionId: "T9999999999999999" }));

    expect(retry.orderId).toBe(first.orderId);
    expect(await prisma.order.count()).toBe(1);
    // Both attempts are kept as payment history.
    expect(await prisma.payment.count()).toBe(2);
  });

  it("does not inflate lifetime value across replays", async () => {
    await submit(phonePePayload());
    await submit(phonePePayload());

    const customer = await prisma.customer.findFirstOrThrow();
    expect(customer.totalOrders).toBe(1);
    expect(customer.totalSpent.toString()).toBe("1440");
  });

  it("keeps two genuinely different orders apart", async () => {
    await submit(phonePePayload());
    await submit(
      phonePePayload({ orderId: "ORD-COOKIE-1002", paymentTransactionId: "T1111111111111111", totalPrice: 600 }),
    );

    expect(await prisma.order.count()).toBe(2);
    expect(await prisma.customer.count()).toBe(1);
    const customer = await prisma.customer.findFirstOrThrow();
    expect(customer.totalOrders).toBe(2);
    expect(customer.totalSpent.toString()).toBe("2040");
  });
});

describe("a failed PhonePe payment", () => {
  it("still records the customer and the attempt, with a FAILED order", async () => {
    const result = await submit(
      phonePePayload({ paymentStatus: "FAILED", failureReason: "Payment declined by bank", paidAt: undefined }),
    );

    expect(result.customerCreated).toBe(true);
    expect(result.orderStatus).toBe("FAILED");

    const customer = await prisma.customer.findFirstOrThrow();
    // History, but not revenue.
    expect(customer.totalOrders).toBe(0);
    expect(customer.totalSpent.toString()).toBe("0");

    const types = (await prisma.event.findMany()).map((e) => e.type);
    expect(types).toContain("PAYMENT_FAILED");
    expect(types).not.toContain("ORDER_CONFIRMED");
  });
});

describe("GET /api/customers/phone/:phone", () => {
  it("returns nothing for a number that has never paid", async () => {
    const { customer, whatsappNumber } = await findCustomerByPhone(tenant.ctx, "+91 90000 55555");
    expect(customer).toBeNull();
    // The normalised form is returned either way, so n8n can reuse it.
    expect(whatsappNumber).toBe("919000055555");
  });

  it("finds the customer once an order has been placed, in any number format", async () => {
    await submit(phonePePayload());

    for (const format of ["+91 90000 55555", "919000055555", "09000055555", "+91-90000-55555"]) {
      const { customer } = await findCustomerByPhone(tenant.ctx, format);
      expect(customer?.name).toBe("Aarti Desai");
    }
  });

  it("rejects an unparseable number as a bad request, not a miss", async () => {
    await expect(findCustomerByPhone(tenant.ctx, "not-a-phone")).rejects.toBeInstanceOf(BusinessRuleError);
  });
});
