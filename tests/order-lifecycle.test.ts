/**
 * Fulfilment lifecycle: status transitions, the [ORDER IS READY] button,
 * [MARK DELIVERED], and the events n8n turns into WhatsApp messages.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { recordPaymentResult } from "@/server/modules/payments/payment.service";
import {
  cancelOrder,
  changeOrderStatus,
  getOrderBoard,
  markOrderReady,
} from "@/server/modules/orders/order.service";
import { assertTransition, canTransition } from "@/server/modules/orders/order.status";
import { dispatchDelivery, markDelivered } from "@/server/modules/deliveries/delivery.service";
import { createReview } from "@/server/modules/reviews/review.service";
import { BusinessRuleError } from "@/server/core/errors";
import { CART_TOTAL, cartItems, createTenant, resetDatabase, type Tenant } from "./helpers";

let tenant: Tenant;
let orderId: string;
let customerId: string;

async function placePaidOrder(number = "919876543210", txn = "txn-1") {
  const result = await recordPaymentResult(tenant.ctx, {
    transactionId: txn,
    status: "SUCCESS",
    amount: CART_TOTAL,
    currency: "INR",
    whatsappNumber: number,
    customer: { name: "Ananya Rao" },
    items: cartItems(),
    deliveryAddress: "12-4-77 Banjara Hills, Hyderabad",
  });
  return { orderId: result.orderId!, customerId: result.customerId! };
}

beforeEach(async () => {
  await resetDatabase();
  tenant = await createTenant();
  ({ orderId, customerId } = await placePaidOrder());
});

describe("status transitions", () => {
  it("walks the happy path and stamps each timestamp", async () => {
    await changeOrderStatus(tenant.ctx, orderId, "PREPARING");
    await changeOrderStatus(tenant.ctx, orderId, "READY");
    await changeOrderStatus(tenant.ctx, orderId, "OUT_FOR_DELIVERY");
    const order = await changeOrderStatus(tenant.ctx, orderId, "DELIVERED");

    expect(order.status).toBe("DELIVERED");
    expect(order.confirmedAt).not.toBeNull();
    expect(order.preparingAt).not.toBeNull();
    expect(order.readyAt).not.toBeNull();
    expect(order.dispatchedAt).not.toBeNull();
    expect(order.deliveredAt).not.toBeNull();
  });

  it("rejects skipping a step", async () => {
    await expect(changeOrderStatus(tenant.ctx, orderId, "DELIVERED")).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(changeOrderStatus(tenant.ctx, orderId, "OUT_FOR_DELIVERY")).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("rejects moving backwards and re-applying the same status", async () => {
    await changeOrderStatus(tenant.ctx, orderId, "PREPARING");
    await expect(changeOrderStatus(tenant.ctx, orderId, "CONFIRMED")).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(changeOrderStatus(tenant.ctx, orderId, "PREPARING")).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it("treats DELIVERED and CANCELLED as final", async () => {
    await cancelOrder(tenant.ctx, orderId, "Customer changed their mind");
    await expect(changeOrderStatus(tenant.ctx, orderId, "PREPARING")).rejects.toBeInstanceOf(BusinessRuleError);
    expect(canTransition("DELIVERED", "PREPARING")).toBe(false);
    expect(() => assertTransition("CANCELLED", "READY")).toThrow();
  });

  it("keeps payment status independent of fulfilment status", async () => {
    await changeOrderStatus(tenant.ctx, orderId, "PREPARING");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PREPARING");
    expect(order.paymentStatus).toBe("SUCCESS");
  });
});

describe("the [ORDER IS READY] button", () => {
  it("sets READY, writes an audit row and emits ORDER_READY", async () => {
    await changeOrderStatus(tenant.ctx, orderId, "PREPARING");
    const order = await markOrderReady(tenant.ctx, orderId);

    expect(order.status).toBe("READY");
    expect(order.readyAt).not.toBeNull();

    const event = await prisma.event.findFirstOrThrow({ where: { type: "ORDER_READY", entityId: orderId } });
    const payload = event.payload as Record<string, unknown>;
    expect(payload.orderNumber).toBe(order.orderNumber);
    expect((payload.customer as Record<string, string>).whatsappNumber).toBe("919876543210");
    // The event is queued for n8n, not delivered by the CRM itself.
    expect(event.status).toBe("PENDING");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "order", entityId: orderId, action: "order.status_changed" },
      orderBy: { createdAt: "desc" },
    });
    expect((audit.oldValue as Record<string, string>).status).toBe("PREPARING");
    expect((audit.newValue as Record<string, string>).status).toBe("READY");
  });

  it("cannot be pressed on an order that is not being prepared", async () => {
    await expect(markOrderReady(tenant.ctx, orderId)).rejects.toBeInstanceOf(BusinessRuleError);
  });
});

describe("delivery V1", () => {
  async function readyDelivery() {
    await changeOrderStatus(tenant.ctx, orderId, "PREPARING");
    await markOrderReady(tenant.ctx, orderId);
    return prisma.delivery.findFirstOrThrow({ where: { orderId } });
  }

  it("creates a delivery shell for a paid order with an address", async () => {
    const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId } });
    expect(delivery.status).toBe("PENDING");
    expect(delivery.deliveryAddress).toContain("Banjara Hills");
    // V1 captures no coordinates; the columns exist for a later version.
    expect(delivery.latitude).toBeNull();
    expect(delivery.longitude).toBeNull();
  });

  it("dispatches only from READY and emits ORDER_OUT_FOR_DELIVERY", async () => {
    const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId } });
    await expect(dispatchDelivery(tenant.ctx, delivery.id)).rejects.toBeInstanceOf(BusinessRuleError);

    await readyDelivery();
    const dispatched = await dispatchDelivery(tenant.ctx, delivery.id);

    expect(dispatched.status).toBe("OUT_FOR_DELIVERY");
    expect(await prisma.event.count({ where: { type: "ORDER_OUT_FOR_DELIVERY" } })).toBe(1);
  });

  it("[MARK DELIVERED] sets both statuses, stamps the time and emits ORDER_DELIVERED", async () => {
    const delivery = await readyDelivery();
    await dispatchDelivery(tenant.ctx, delivery.id);

    const delivered = await markDelivered(tenant.ctx, delivery.id, "Handed to customer");

    expect(delivered.status).toBe("DELIVERED");
    expect(delivered.deliveredAt).not.toBeNull();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("DELIVERED");
    expect(order.deliveredAt).not.toBeNull();

    const event = await prisma.event.findFirstOrThrow({ where: { type: "ORDER_DELIVERED" } });
    expect(event.entityId).toBe(orderId);
    expect(event.status).toBe("PENDING");

    await prisma.auditLog.findFirstOrThrow({ where: { action: "delivery.marked_delivered" } });
  });

  it("does not emit a second event when the button is pressed twice", async () => {
    const delivery = await readyDelivery();
    await dispatchDelivery(tenant.ctx, delivery.id);
    await markDelivered(tenant.ctx, delivery.id);
    await markDelivered(tenant.ctx, delivery.id);

    expect(await prisma.event.count({ where: { type: "ORDER_DELIVERED" } })).toBe(1);
  });
});

describe("reviews", () => {
  it("links the review to the right order and customer and emits REVIEW_RECEIVED", async () => {
    const { review } = await createReview(tenant.ctx, {
      orderId,
      rating: 5,
      comment: "Delicious, arrived hot!",
      source: "WHATSAPP",
    });

    expect(review.orderId).toBe(orderId);
    // Taken from the order, never from the request body.
    expect(review.customerId).toBe(customerId);
    expect(review.rating).toBe(5);

    const event = await prisma.event.findFirstOrThrow({ where: { type: "REVIEW_RECEIVED" } });
    expect((event.payload as Record<string, unknown>).rating).toBe(5);
  });

  it("resolves the order by order number, as n8n sends it", async () => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const { review } = await createReview(tenant.ctx, {
      orderNumber: order.orderNumber,
      rating: 4,
      source: "WHATSAPP",
    });
    expect(review.orderId).toBe(orderId);
  });

  it("refuses to attach a review to another customer's order", async () => {
    const second = await placePaidOrder("919812345678", "txn-2");
    const { review } = await createReview(tenant.ctx, { orderId: second.orderId, rating: 3, source: "WHATSAPP" });

    expect(review.customerId).toBe(second.customerId);
    expect(review.customerId).not.toBe(customerId);
  });

  it("rejects a rating outside 1-5 at the schema boundary", async () => {
    const { createReviewSchema } = await import("@/server/modules/reviews/review.schema");
    expect(createReviewSchema.safeParse({ orderId, rating: 6 }).success).toBe(false);
    expect(createReviewSchema.safeParse({ orderId, rating: 0 }).success).toBe(false);
    expect(createReviewSchema.safeParse({ orderId, rating: 5 }).success).toBe(true);
  });

  it("cannot review a cancelled order", async () => {
    await cancelOrder(tenant.ctx, orderId);
    await expect(createReview(tenant.ctx, { orderId, rating: 5, source: "WHATSAPP" })).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });
});

describe("the kitchen board", () => {
  it("groups live orders into the five working columns", async () => {
    const second = await placePaidOrder("919812345678", "txn-2");
    await changeOrderStatus(tenant.ctx, second.orderId, "PREPARING");

    const board = await getOrderBoard(tenant.ctx);
    expect(board.map((c) => c.status)).toEqual([
      "CONFIRMED",
      "PREPARING",
      "READY",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ]);
    expect(board[0].orders).toHaveLength(1);
    expect(board[1].orders).toHaveLength(1);
  });

  it("keeps cancelled orders off the board", async () => {
    await cancelOrder(tenant.ctx, orderId);
    const board = await getOrderBoard(tenant.ctx);
    expect(board.flatMap((c) => c.orders)).toHaveLength(0);
  });
});

describe("order numbering", () => {
  it("keeps issuing fresh numbers after older orders are backdated or removed", async () => {
    // Regression: deriving the sequence from a row count broke as soon as
    // orders were backdated out of "today" — the next number collided with one
    // already issued.
    const numbers: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const result = await placePaidOrder(`9198765432${10 + i}`, `txn-seq-${i}`);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } });
      numbers.push(order.orderNumber);

      // Push every other order into the past, as the seed script does.
      if (i % 2 === 0) {
        await prisma.order.update({
          where: { id: order.id },
          data: { createdAt: new Date(Date.now() - 5 * 86_400_000) },
        });
      }
    }

    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.every((n) => /^ORD-\d{6}-\d{4}$/.test(n))).toBe(true);
  });

  it("issues unique numbers for orders created concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => placePaidOrder(`91900000${1000 + i}`, `txn-par-${i}`)),
    );
    const orders = await prisma.order.findMany({ where: { id: { in: results.map((r) => r.orderId) } } });
    expect(new Set(orders.map((o) => o.orderNumber)).size).toBe(6);
  });
});
