/**
 * The rule the whole system is built around:
 *
 *   A permanent CRM customer exists ONLY because a payment attempt reached a
 *   terminal result. Conversations, menu questions, carts and abandoned
 *   checkouts leave the customers table untouched.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { recordMessage } from "@/server/modules/conversations/conversation.service";
import { abandonCheckoutSession, upsertCheckoutSession } from "@/server/modules/checkout/checkout.service";
import { recordPaymentResult } from "@/server/modules/payments/payment.service";
import { CART_TOTAL, cartItems, createTenant, resetDatabase, type Tenant } from "./helpers";

let tenant: Tenant;

beforeEach(async () => {
  await resetDatabase();
  tenant = await createTenant();
});

describe("no customer is created from conversation activity", () => {
  it("does not create a customer when somebody only says hello", async () => {
    await recordMessage(tenant.ctx, {
      whatsappNumber: "919876543210",
      direction: "INBOUND",
      message: "Hello",
      status: "DELIVERED",
    });

    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.conversationSession.count()).toBe(1);
  });

  it("does not create a customer for menu, price or general questions", async () => {
    const questions = [
      "What's on the menu today?",
      "How much is the biryani?",
      "Do you deliver to Gachibowli?",
      "Are you open now?",
    ];

    for (const [index, text] of questions.entries()) {
      await recordMessage(tenant.ctx, {
        whatsappNumber: "919876543210",
        direction: "INBOUND",
        message: text,
        status: "DELIVERED",
        externalMessageId: `wamid.${index}`,
      });
    }

    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.message.count()).toBe(4);
    // The thread exists but is not attached to any customer.
    const conversation = await prisma.conversationSession.findFirstOrThrow();
    expect(conversation.customerId).toBeNull();
  });

  it("leaves message.customerId null while the sender is not yet a customer", async () => {
    const { message } = await recordMessage(tenant.ctx, {
      whatsappNumber: "919876543210",
      direction: "INBOUND",
      message: "Hi",
      status: "DELIVERED",
    });
    expect(message.customerId).toBeNull();
  });
});

describe("no customer is created from the temporary checkout layer", () => {
  it("does not create a customer when a cart is started", async () => {
    await upsertCheckoutSession(tenant.ctx, {
      sessionId: "sess-1",
      whatsappNumber: "919876543210",
      customerName: "Interested Person",
      items: cartItems(),
      deliveryFee: 40,
      discount: 0,
      tax: 0,
      expiresInMinutes: 60,
    });

    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.checkoutSession.count()).toBe(1);
  });

  it("does not create a customer when checkout is abandoned", async () => {
    await upsertCheckoutSession(tenant.ctx, {
      sessionId: "sess-1",
      whatsappNumber: "919876543210",
      items: cartItems(),
      deliveryFee: 0,
      discount: 0,
      tax: 0,
      expiresInMinutes: 60,
    });
    await abandonCheckoutSession(tenant.ctx, "sess-1");

    const session = await prisma.checkoutSession.findFirstOrThrow();
    expect(session.status).toBe("ABANDONED");
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.order.count()).toBe(0);
  });

  it("does not create a customer while payment is still PENDING", async () => {
    await upsertCheckoutSession(tenant.ctx, {
      sessionId: "sess-1",
      whatsappNumber: "919876543210",
      items: cartItems(),
      deliveryFee: 0,
      discount: 0,
      tax: 0,
      expiresInMinutes: 60,
    });

    const result = await recordPaymentResult(tenant.ctx, {
      transactionId: "txn-pending-1",
      status: "PENDING",
      amount: CART_TOTAL,
      currency: "INR",
      whatsappNumber: "919876543210",
      checkoutSessionId: "sess-1",
    });

    expect(result.customerId).toBeNull();
    expect(result.orderId).toBeNull();
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.order.count()).toBe(0);
    // The intent is recorded so the later terminal call can update it in place.
    expect(await prisma.payment.count()).toBe(1);
  });

  it("creates nothing permanent across a whole browse-and-leave journey", async () => {
    const number = "919999888877";
    await recordMessage(tenant.ctx, { whatsappNumber: number, direction: "INBOUND", message: "hi", status: "DELIVERED" });
    await recordMessage(tenant.ctx, { whatsappNumber: number, direction: "INBOUND", message: "menu?", status: "DELIVERED" });
    await upsertCheckoutSession(tenant.ctx, {
      sessionId: "sess-browse",
      whatsappNumber: number,
      items: cartItems(),
      deliveryFee: 40,
      discount: 0,
      tax: 0,
      expiresInMinutes: 30,
    });
    await recordPaymentResult(tenant.ctx, {
      transactionId: "txn-browse",
      status: "PENDING",
      amount: CART_TOTAL,
      currency: "INR",
      whatsappNumber: number,
      checkoutSessionId: "sess-browse",
    });
    await abandonCheckoutSession(tenant.ctx, "sess-browse");

    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.orderItem.count()).toBe(0);
    expect(await prisma.review.count()).toBe(0);
  });
});

describe("a terminal payment result creates the customer", () => {
  it("creates the customer, order, items and payment on SUCCESS", async () => {
    await upsertCheckoutSession(tenant.ctx, {
      sessionId: "sess-ok",
      whatsappNumber: "+91 98765 43210",
      customerName: "Ananya Rao",
      items: cartItems(),
      deliveryAddress: "12-4-77 Banjara Hills",
      deliveryFee: 40,
      discount: 0,
      tax: 0,
      expiresInMinutes: 60,
    });

    const result = await recordPaymentResult(tenant.ctx, {
      transactionId: "txn-success-1",
      status: "SUCCESS",
      amount: CART_TOTAL + 40,
      currency: "INR",
      paymentMethod: "UPI",
      gateway: "razorpay",
      whatsappNumber: "+91 98765 43210",
      customer: { name: "Ananya Rao" },
      checkoutSessionId: "sess-ok",
    });

    expect(result.customerCreated).toBe(true);
    expect(result.orderStatus).toBe("CONFIRMED");
    expect(result.paymentStatus).toBe("SUCCESS");

    const customer = await prisma.customer.findFirstOrThrow();
    // Stored in normalised E.164-without-plus form regardless of input format.
    expect(customer.whatsappNumber).toBe("919876543210");
    expect(customer.name).toBe("Ananya Rao");
    expect(customer.totalOrders).toBe(1);
    expect(customer.totalSpent.toString()).toBe("640");

    const order = await prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.items).toHaveLength(2);
    expect(order.totalAmount.toString()).toBe("640");

    const session = await prisma.checkoutSession.findFirstOrThrow();
    expect(session.status).toBe("CONVERTED");
  });

  it("creates the customer on FAILED too, with a FAILED order", async () => {
    const result = await recordPaymentResult(tenant.ctx, {
      transactionId: "txn-failed-1",
      status: "FAILED",
      amount: CART_TOTAL,
      currency: "INR",
      failureReason: "Insufficient funds",
      whatsappNumber: "919876543210",
      customer: { name: "Rahul Menon" },
      items: cartItems(),
    });

    expect(result.customerCreated).toBe(true);
    expect(result.orderStatus).toBe("FAILED");

    const customer = await prisma.customer.findFirstOrThrow();
    // A failed payment is history, but not revenue.
    expect(customer.totalOrders).toBe(0);
    expect(customer.totalSpent.toString()).toBe("0");

    const payment = await prisma.payment.findFirstOrThrow();
    expect(payment.status).toBe("FAILED");
    expect(payment.failureReason).toBe("Insufficient funds");
    expect(payment.paidAt).toBeNull();
  });
});

describe("customers are identified by WhatsApp number", () => {
  it("reuses the existing customer instead of duplicating", async () => {
    const base = {
      status: "SUCCESS" as const,
      amount: CART_TOTAL,
      currency: "INR",
      items: cartItems(),
      whatsappNumber: "919876543210",
    };

    const first = await recordPaymentResult(tenant.ctx, { ...base, transactionId: "txn-a", customer: { name: "Ananya" } });
    const second = await recordPaymentResult(tenant.ctx, { ...base, transactionId: "txn-b" });

    expect(first.customerCreated).toBe(true);
    expect(second.customerCreated).toBe(false);
    expect(second.customerId).toBe(first.customerId);

    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.order.count()).toBe(2);

    const customer = await prisma.customer.findFirstOrThrow();
    expect(customer.totalOrders).toBe(2);
    expect(customer.totalSpent.toString()).toBe("1200");
  });

  it("treats differently formatted versions of a number as the same person", async () => {
    const formats = ["919876543210", "+91 98765 43210", "098765 43210", "+91-98765-43210"];

    for (const [index, number] of formats.entries()) {
      await recordPaymentResult(tenant.ctx, {
        transactionId: `txn-format-${index}`,
        status: "SUCCESS",
        amount: 100,
        currency: "INR",
        whatsappNumber: number,
        items: [{ name: "Chai", price: 100, quantity: 1 }],
      });
    }

    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.order.count()).toBe(4);
  });

  it("enforces one customer per WhatsApp number at the database level", async () => {
    await prisma.customer.create({
      data: { restaurantId: tenant.restaurantId, whatsappNumber: "919876543210", name: "First" },
    });

    await expect(
      prisma.customer.create({
        data: { restaurantId: tenant.restaurantId, whatsappNumber: "919876543210", name: "Duplicate" },
      }),
    ).rejects.toThrow();
  });
});
