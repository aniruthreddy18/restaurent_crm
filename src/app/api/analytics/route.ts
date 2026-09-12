import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import {
  getConversionFunnel,
  getCustomerStats,
  getDashboardSummary,
  getOrderStatusSummary,
  getRevenueSeries,
  getTopProducts,
} from "@/server/modules/analytics/analytics.service";

export const GET = withApi({ permission: "analytics:read" }, async ({ ctx }) => {
  const [summary, revenue, customers, products, statuses, funnel] = await Promise.all([
    getDashboardSummary(ctx),
    getRevenueSeries(ctx, 30),
    getCustomerStats(ctx),
    getTopProducts(ctx),
    getOrderStatusSummary(ctx),
    getConversionFunnel(ctx),
  ]);

  return ok({
    summary: { ...summary, revenueToday: summary.revenueToday.toString(), averageOrderValue: summary.averageOrderValue.toString(), recentOrders: undefined },
    revenue,
    customers: { ...customers, lifetimeValue: customers.lifetimeValue.toString() },
    products,
    statuses,
    funnel,
  });
});
