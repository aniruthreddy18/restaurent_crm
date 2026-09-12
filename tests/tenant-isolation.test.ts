/**
 * Restaurant A must never be able to read or change Restaurant B's data.
 * Isolation is structural: every service takes the restaurantId from the
 * authenticated principal and puts it in the WHERE clause, so an id belonging
 * to another tenant simply does not match.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/prisma";
import { recordPaymentResult } from "@/server/modules/payments/payment.service";
import { getCustomer, listCustomers, updateCustomer } from "@/server/modules/customers/customer.service";
import { changeOrderStatus, getOrder, listOrders, markOrderReady } from "@/server/modules/orders/order.service";
import { getPayment, listPayments } from "@/server/modules/payments/payment.service";
import { createReview } from "@/server/modules/reviews/review.service";
import { getDelivery } from "@/server/modules/deliveries/delivery.service";
import { NotFoundError } from "@/server/core/errors";
import { CART_TOTAL, cartItems, createTenant, resetDatabase, type Tenant } from "./helpers";

let alpha: Tenant;
let beta: Tenant;
let betaOrderId: string;
let betaCustomerId: string;

beforeEach(async () => {
  await resetDatabase();
  alpha = await createTenant("Alpha Kitchen", "alpha");
  beta = await createTenant("Beta Kitchen", "beta");

  const result = await recordPaymentResult(beta.ctx, {
    transactionId: "txn-beta-1",
    status: "SUCCESS",
    amount: CART_TOTAL,
    currency: "INR",
    whatsappNumber: "919876543210",
    customer: { name: "Beta Customer" },
    items: cartItems(),
    deliveryAddress: "Beta Street 1",
  });
  betaOrderId = result.orderId!;
  betaCustomerId = result.customerId!;
});

describe("reads are scoped to the tenant", () => {
  it("does not list another restaurant's customers", async () => {
    const list = await listCustomers(alpha.ctx, { page: 1, pageSize: 20, sort: "recent" });
    expect(list.meta.total).toBe(0);
    expect(list.data).toHaveLength(0);

    const own = await listCustomers(beta.ctx, { page: 1, pageSize: 20, sort: "recent" });
    expect(own.meta.total).toBe(1);
  });

  it("does not list another restaurant's orders or payments", async () => {
    expect((await listOrders(alpha.ctx, { page: 1, pageSize: 20 })).meta.total).toBe(0);
    expect((await listPayments(alpha.ctx, { page: 1, pageSize: 20 })).meta.total).toBe(0);
    expect((await listOrders(beta.ctx, { page: 1, pageSize: 20 })).meta.total).toBe(1);
  });

  it("404s on a direct fetch by another restaurant's id", async () => {
    await expect(getCustomer(alpha.ctx, betaCustomerId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getOrder(alpha.ctx, betaOrderId)).rejects.toBeInstanceOf(NotFoundError);

    const payment = await prisma.payment.findFirstOrThrow({ where: { restaurantId: beta.restaurantId } });
    await expect(getPayment(alpha.ctx, payment.id)).rejects.toBeInstanceOf(NotFoundError);

    const delivery = await prisma.delivery.findFirstOrThrow({ where: { restaurantId: beta.restaurantId } });
    await expect(getDelivery(alpha.ctx, delivery.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("writes are scoped to the tenant", () => {
  it("cannot change another restaurant's order status", async () => {
    await expect(changeOrderStatus(alpha.ctx, betaOrderId, "PREPARING")).rejects.toBeInstanceOf(NotFoundError);
    await expect(markOrderReady(alpha.ctx, betaOrderId)).rejects.toBeInstanceOf(NotFoundError);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: betaOrderId } });
    expect(order.status).toBe("CONFIRMED");
  });

  it("cannot update another restaurant's customer", async () => {
    await expect(updateCustomer(alpha.ctx, betaCustomerId, { name: "Hacked" })).rejects.toBeInstanceOf(NotFoundError);
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: betaCustomerId } });
    expect(customer.name).toBe("Beta Customer");
  });

  it("cannot attach a review to another restaurant's order", async () => {
    await expect(
      createReview(alpha.ctx, { orderId: betaOrderId, rating: 1, source: "WHATSAPP" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await prisma.review.count()).toBe(0);
  });
});

describe("the same WhatsApp number in two restaurants", () => {
  it("is two independent customers, not one shared record", async () => {
    await recordPaymentResult(alpha.ctx, {
      transactionId: "txn-alpha-1",
      status: "SUCCESS",
      amount: 300,
      currency: "INR",
      whatsappNumber: "919876543210",
      customer: { name: "Alpha Customer" },
      items: [{ name: "Chai", price: 300, quantity: 1 }],
    });

    const customers = await prisma.customer.findMany({ where: { whatsappNumber: "919876543210" } });
    expect(customers).toHaveLength(2);
    expect(new Set(customers.map((c) => c.restaurantId)).size).toBe(2);

    // Spend stays separate per restaurant.
    const alphaCustomer = customers.find((c) => c.restaurantId === alpha.restaurantId)!;
    const betaCustomer = customers.find((c) => c.restaurantId === beta.restaurantId)!;
    expect(alphaCustomer.totalSpent.toString()).toBe("300");
    expect(betaCustomer.totalSpent.toString()).toBe(String(CART_TOTAL));
  });
});

describe("events and audit trails stay in their tenant", () => {
  it("never leaks another restaurant's events", async () => {
    const alphaEvents = await prisma.event.count({ where: { restaurantId: alpha.restaurantId } });
    const betaEvents = await prisma.event.count({ where: { restaurantId: beta.restaurantId } });
    expect(alphaEvents).toBe(0);
    expect(betaEvents).toBeGreaterThan(0);
  });
});
