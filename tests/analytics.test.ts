/**
 * Dashboard and analytics queries. These run raw SQL and aggregate across the
 * whole schema, so they earn a test of their own — a broken cast here takes
 * the entire dashboard down.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { recordPaymentResult } from "@/server/modules/payments/payment.service";
import { changeOrderStatus } from "@/server/modules/orders/order.service";
import { upsertCheckoutSession } from "@/server/modules/checkout/checkout.service";
import { recordMessage } from "@/server/modules/conversations/conversation.service";
import {
  getConversionFunnel,
  getCustomerStats,
  getDashboardSummary,
  getOrderStatusSummary,
  getRevenueSeries,
  getTopProducts,
} from "@/server/modules/analytics/analytics.service";
import { CART_TOTAL, cartItems, createTenant, resetDatabase, type Tenant } from "./helpers";

let tenant: Tenant;

beforeEach(async () => {
  await resetDatabase();
  tenant = await createTenant();
});

async function paidOrder(txn: string, number = "919876543210") {
  const result = await recordPaymentResult(tenant.ctx, {
    transactionId: txn,
    status: "SUCCESS",
    amount: CART_TOTAL,
    currency: "INR",
    whatsappNumber: number,
    items: cartItems(),
    deliveryAddress: "1 Test Road",
  });
  return result;
}

describe("dashboard summary", () => {
  it("returns zeroed tiles for a brand new restaurant", async () => {
    const summary = await getDashboardSummary(tenant.ctx);
    expect(summary.ordersToday).toBe(0);
    expect(summary.revenueToday.toString()).toBe("0");
    expect(summary.averageRating).toBeNull();
    expect(summary.recentOrders).toHaveLength(0);
  });

  it("counts today's orders, revenue and pipeline", async () => {
    const first = await paidOrder("txn-1");
    await paidOrder("txn-2", "919812345678");
    await changeOrderStatus(tenant.ctx, first.orderId!, "PREPARING");

    const summary = await getDashboardSummary(tenant.ctx);
    expect(summary.ordersToday).toBe(2);
    expect(summary.revenueToday.toString()).toBe(String(CART_TOTAL * 2));
    expect(summary.averageOrderValue.toString()).toBe(String(CART_TOTAL));
    expect(summary.newCustomersToday).toBe(2);
    expect(summary.confirmed).toBe(1);
    expect(summary.preparing).toBe(1);
  });

  it("counts active carts without counting them as orders", async () => {
    await upsertCheckoutSession(tenant.ctx, {
      sessionId: "sess-1",
      whatsappNumber: "919000000001",
      items: cartItems(),
      deliveryFee: 0,
      discount: 0,
      tax: 0,
      expiresInMinutes: 60,
    });

    const summary = await getDashboardSummary(tenant.ctx);
    expect(summary.activeCarts).toBe(1);
    expect(summary.ordersToday).toBe(0);
    expect(summary.newCustomersToday).toBe(0);
  });
});

describe("revenue series", () => {
  it("returns one point per day, gaps filled with zero", async () => {
    const series = await getRevenueSeries(tenant.ctx, 14);
    expect(series).toHaveLength(14);
    expect(series.every((p) => p.revenue === 0 && p.orders === 0)).toBe(true);
    // Chronological, ending today.
    expect(series[13].date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("includes paid orders and excludes failed ones", async () => {
    await paidOrder("txn-1");
    await recordPaymentResult(tenant.ctx, {
      transactionId: "txn-failed",
      status: "FAILED",
      amount: 999,
      currency: "INR",
      whatsappNumber: "919812345678",
      items: cartItems(),
    });

    const series = await getRevenueSeries(tenant.ctx, 7);
    const today = series[series.length - 1];
    expect(today.revenue).toBe(CART_TOTAL);
    expect(today.orders).toBe(1);
  });
});

describe("aggregates", () => {
  it("reports customer tiers, top products, statuses and the funnel", async () => {
    await recordMessage(tenant.ctx, {
      whatsappNumber: "919000000009",
      direction: "INBOUND",
      message: "hi",
      status: "DELIVERED",
    });
    await paidOrder("txn-1");

    const [customers, products, statuses, funnel] = await Promise.all([
      getCustomerStats(tenant.ctx),
      getTopProducts(tenant.ctx),
      getOrderStatusSummary(tenant.ctx),
      getConversionFunnel(tenant.ctx),
    ]);

    expect(customers.totalCustomers).toBe(1);
    expect(customers.byType.find((t) => t.type === "NEW")?.count).toBe(1);
    expect(customers.topCustomers).toHaveLength(1);

    expect(products.map((p) => p.name)).toContain("Garlic Naan");
    expect(products.find((p) => p.name === "Garlic Naan")?.quantity).toBe(2);

    expect(statuses.find((s) => s.status === "CONFIRMED")?.count).toBe(1);

    // One conversation, no cart, one paid order.
    expect(funnel.find((f) => f.stage === "Conversations")?.count).toBe(1);
    expect(funnel.find((f) => f.stage === "Paid orders")?.count).toBe(1);
  });
});
