/**
 * Payment providers and n8n both retry. Replays must be free: the same webhook
 * five times must yield exactly one customer, order, payment and event.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { recordPaymentResult } from "@/server/modules/payments/payment.service";
import { withIdempotency } from "@/server/idempotency/idempotency";
import { upsertCheckoutSession } from "@/server/modules/checkout/checkout.service";
import { recordMessage } from "@/server/modules/conversations/conversation.service";
import { createReview } from "@/server/modules/reviews/review.service";
import { ConflictError } from "@/server/core/errors";
import { CART_TOTAL, cartItems, createTenant, resetDatabase, type Tenant } from "./helpers";

let tenant: Tenant;

const payload = {
  transactionId: "txn-replay-1",
  status: "SUCCESS" as const,
  amount: CART_TOTAL,
  currency: "INR",
  paymentMethod: "UPI",
  gateway: "razorpay",
  whatsappNumber: "919876543210",
  customer: { name: "Ananya Rao" },
  items: cartItems(),
  externalEventId: "evt_provider_001",
};

beforeEach(async () => {
  await resetDatabase();
  tenant = await createTenant();
});

describe("duplicate payment webhooks", () => {
  it("produces exactly one of everything when delivered five times", async () => {
    const results: Awaited<ReturnType<typeof recordPaymentResult>>[] = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await recordPaymentResult(tenant.ctx, payload));
    }

    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.orderItem.count()).toBe(2);

    // Only the first call did the work.
    expect(results[0].replayed).toBe(false);
    expect(results.slice(1).every((r) => r.replayed)).toBe(true);
    expect(results.every((r) => r.orderId === results[0].orderId)).toBe(true);

    // One PAYMENT_SUCCESS and one ORDER_CONFIRMED — not five of each.
    const events = await prisma.event.groupBy({ by: ["type"], _count: { _all: true } });
    const byType = Object.fromEntries(events.map((e) => [e.type, e._count._all]));
    expect(byType.PAYMENT_SUCCESS).toBe(1);
    expect(byType.ORDER_CONFIRMED).toBe(1);
    expect(byType.CUSTOMER_CREATED).toBe(1);
  });

  it("does not inflate lifetime value on replay", async () => {
    await recordPaymentResult(tenant.ctx, payload);
    await recordPaymentResult(tenant.ctx, payload);
    await recordPaymentResult(tenant.ctx, payload);

    const customer = await prisma.customer.findFirstOrThrow();
    expect(customer.totalOrders).toBe(1);
    expect(customer.totalSpent.toString()).toBe(String(CART_TOTAL));
  });

  it("survives concurrent delivery of the same webhook", async () => {
    // Retries arriving before the first has committed collide on the unique
    // constraints; withConcurrencyRetry re-runs the transaction so every
    // caller still gets a successful, identical answer.
    const results = await Promise.all(
      Array.from({ length: 4 }, () => recordPaymentResult(tenant.ctx, payload)),
    );

    expect(results.every((r) => r.orderId === results[0].orderId)).toBe(true);
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.payment.count()).toBe(1);
  });

  it("de-duplicates the event by externalEventId", async () => {
    await recordPaymentResult(tenant.ctx, payload);
    // Same provider event id, different transaction — still one event row.
    await recordPaymentResult(tenant.ctx, { ...payload, transactionId: "txn-replay-2" });

    const events = await prisma.event.findMany({ where: { type: "PAYMENT_SUCCESS" } });
    expect(events).toHaveLength(1);
    expect(events[0].externalEventId).toBe("evt_provider_001");
  });
});

describe("a failed payment followed by a successful retry", () => {
  it("reuses the customer and revives the order rather than duplicating", async () => {
    await upsertCheckoutSession(tenant.ctx, {
      sessionId: "sess-retry",
      whatsappNumber: "919876543210",
      items: cartItems(),
      deliveryFee: 0,
      discount: 0,
      tax: 0,
      expiresInMinutes: 60,
    });

    const failed = await recordPaymentResult(tenant.ctx, {
      transactionId: "txn-fail",
      status: "FAILED",
      amount: CART_TOTAL,
      currency: "INR",
      failureReason: "Card declined",
      whatsappNumber: "919876543210",
      checkoutSessionId: "sess-retry",
    });
    expect(failed.orderStatus).toBe("FAILED");

    const retried = await recordPaymentResult(tenant.ctx, {
      transactionId: "txn-retry",
      status: "SUCCESS",
      amount: CART_TOTAL,
      currency: "INR",
      whatsappNumber: "919876543210",
      checkoutSessionId: "sess-retry",
    });

    expect(retried.customerCreated).toBe(false);
    expect(retried.orderId).toBe(failed.orderId);
    expect(retried.orderStatus).toBe("CONFIRMED");

    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    // Two payment attempts are genuine history and are both kept.
    expect(await prisma.payment.count()).toBe(2);
  });
});

describe("generic idempotency records", () => {
  it("returns the stored response without re-running the work", async () => {
    let runs = 0;
    const work = async () => {
      runs += 1;
      return { value: runs };
    };

    const first = await withIdempotency(tenant.ctx, "test", "key-1", { a: 1 }, work);
    const second = await withIdempotency(tenant.ctx, "test", "key-1", { a: 1 }, work);

    expect(runs).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.result).toEqual(first.result);
  });

  it("rejects a reused key carrying a different body", async () => {
    await withIdempotency(tenant.ctx, "test", "key-1", { a: 1 }, async () => ({ ok: true }));
    await expect(
      withIdempotency(tenant.ctx, "test", "key-1", { a: 2 }, async () => ({ ok: true })),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("other replayed webhooks", () => {
  it("stores a repeated WhatsApp message only once", async () => {
    const input = {
      whatsappNumber: "919876543210",
      direction: "INBOUND" as const,
      message: "Hello",
      status: "SENT" as const,
      externalMessageId: "wamid.ABC123",
    };

    const first = await recordMessage(tenant.ctx, input);
    const second = await recordMessage(tenant.ctx, input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.message.id).toBe(first.message.id);
    expect(await prisma.message.count()).toBe(1);
  });

  it("stores only one review per order", async () => {
    const result = await recordPaymentResult(tenant.ctx, payload);

    const first = await createReview(tenant.ctx, { orderId: result.orderId!, rating: 5, source: "WHATSAPP" });
    const second = await createReview(tenant.ctx, { orderId: result.orderId!, rating: 1, source: "WHATSAPP" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await prisma.review.count()).toBe(1);
    expect((await prisma.review.findFirstOrThrow()).rating).toBe(5);
  });
});
