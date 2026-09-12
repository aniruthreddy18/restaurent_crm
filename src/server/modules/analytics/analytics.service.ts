import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { assertCan } from "@/server/auth/permissions";

/** Inclusive day bounds in the server's local timezone. */
export function dayRange(date = new Date()) {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(date);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

export function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

export type DashboardSummary = Awaited<ReturnType<typeof getDashboardSummary>>;

/**
 * Every tile on the dashboard in one round of queries. Counts come from the
 * database rather than from cached counters so the numbers can never drift.
 */
export async function getDashboardSummary(ctx: TenantContext) {
  const restaurantId = ctx.restaurantId;
  const { from, to } = dayRange();

  const paidToday: Prisma.OrderWhereInput = {
    restaurantId,
    createdAt: { gte: from, lte: to },
    paymentStatus: "SUCCESS",
    status: { notIn: ["CANCELLED", "FAILED"] },
  };

  const [
    ordersToday,
    revenueToday,
    newCustomersToday,
    pendingPayments,
    statusCounts,
    avgRating,
    activeCarts,
    recentOrders,
    failedPaymentsToday,
  ] = await Promise.all([
    prisma.order.count({ where: { restaurantId, createdAt: { gte: from, lte: to } } }),
    prisma.order.aggregate({ where: paidToday, _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.customer.count({ where: { restaurantId, createdAt: { gte: from, lte: to } } }),
    prisma.payment.count({ where: { restaurantId, status: "PENDING" } }),
    prisma.order.groupBy({
      by: ["status"],
      where: { restaurantId, status: { in: ["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] } },
      _count: { _all: true },
    }),
    prisma.review.aggregate({ where: { restaurantId }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.checkoutSession.count({ where: { restaurantId, status: "ACTIVE", expiresAt: { gt: new Date() } } }),
    prisma.order.findMany({
      where: { restaurantId },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        customer: { select: { id: true, name: true, whatsappNumber: true } },
        items: { select: { quantity: true } },
      },
    }),
    prisma.payment.count({ where: { restaurantId, status: "FAILED", createdAt: { gte: from, lte: to } } }),
  ]);

  const deliveredToday = await prisma.order.count({
    where: { restaurantId, status: "DELIVERED", deliveredAt: { gte: from, lte: to } },
  });

  const revenue = new Prisma.Decimal(revenueToday._sum.totalAmount ?? 0);
  const paidOrderCount = revenueToday._count._all;

  const byStatus = (status: string) => statusCounts.find((s) => s.status === status)?._count._all ?? 0;

  return {
    ordersToday,
    revenueToday: revenue,
    averageOrderValue: paidOrderCount
      ? revenue.dividedBy(paidOrderCount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      : new Prisma.Decimal(0),
    newCustomersToday,
    pendingPayments,
    failedPaymentsToday,
    confirmed: byStatus("CONFIRMED"),
    preparing: byStatus("PREPARING"),
    ready: byStatus("READY"),
    outForDelivery: byStatus("OUT_FOR_DELIVERY"),
    deliveredToday,
    averageRating: avgRating._avg.rating ? Number(avgRating._avg.rating.toFixed(2)) : null,
    totalReviews: avgRating._count._all,
    activeCarts,
    recentOrders,
  };
}

/** YYYY-MM-DD for an instant, as seen in a given IANA timezone. */
function dateKeyInZone(date: Date, timeZone: string) {
  // "en-CA" formats as YYYY-MM-DD, which sorts and compares as a plain string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Daily revenue + order count for the dashboard chart.
 *
 * Days are bucketed in the restaurant's own timezone, not the database's and
 * not the server's — a restaurant's "Tuesday takings" must mean their Tuesday.
 */
export async function getRevenueSeries(ctx: TenantContext, days = 14) {
  const since = daysAgo(days);

  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: ctx.restaurantId },
    select: { timezone: true },
  });
  const timezone = restaurant.timezone || "UTC";

  const rows = await prisma.$queryRaw<{ day: Date; revenue: Prisma.Decimal; orders: bigint }[]>`
    -- AT TIME ZONE shifts the timestamptz into the restaurant's wall-clock time
    -- before truncating, so each bucket is one of their calendar days.
    SELECT date_trunc('day', "created_at" AT TIME ZONE ${timezone}) AS day,
           COALESCE(SUM("total_amount"), 0) AS revenue,
           COUNT(*) AS orders
    FROM orders
    -- restaurant_id is TEXT (Prisma maps String ids to text, not native uuid),
    -- so the bound parameter must not be cast.
    WHERE "restaurant_id" = ${ctx.restaurantId}
      AND "created_at" >= ${since}
      AND "payment_status" = 'SUCCESS'
      AND "status" NOT IN ('CANCELLED', 'FAILED')
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  // date_trunc(... AT TIME ZONE ...) yields a naive timestamp, which the driver
  // hands back as a Date built from the SERVER's timezone — so reading its
  // local components recovers the restaurant-local calendar day unchanged.
  const byDay = new Map(
    rows.map((r) => [
      [
        r.day.getFullYear(),
        String(r.day.getMonth() + 1).padStart(2, "0"),
        String(r.day.getDate()).padStart(2, "0"),
      ].join("-"),
      r,
    ]),
  );

  // Fill gaps so the chart has a point for every day, not just busy ones.
  const series: { date: string; label: string; revenue: number; orders: number }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const instant = new Date(Date.now() - i * 86_400_000);
    const key = dateKeyInZone(instant, timezone);
    const row = byDay.get(key);
    const [year, month, day] = key.split("-").map(Number);

    series.push({
      date: key,
      // Format from the plain parts in UTC so the label cannot drift a day.
      label: new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" }).format(
        new Date(Date.UTC(year, month - 1, day)),
      ),
      revenue: row ? new Prisma.Decimal(row.revenue).toNumber() : 0,
      orders: row ? Number(row.orders) : 0,
    });
  }

  return series;
}

export async function getCustomerStats(ctx: TenantContext) {
  assertCan(ctx, "analytics:read");

  const [byType, topCustomers, totals, repeatRate] = await Promise.all([
    prisma.customer.groupBy({
      by: ["customerType"],
      where: { restaurantId: ctx.restaurantId },
      _count: { _all: true },
    }),
    prisma.customer.findMany({
      where: { restaurantId: ctx.restaurantId, totalOrders: { gt: 0 } },
      orderBy: { totalSpent: "desc" },
      take: 10,
      select: { id: true, name: true, whatsappNumber: true, totalOrders: true, totalSpent: true, customerType: true },
    }),
    prisma.customer.aggregate({
      where: { restaurantId: ctx.restaurantId },
      _count: { _all: true },
      _sum: { totalSpent: true },
    }),
    prisma.customer.count({ where: { restaurantId: ctx.restaurantId, totalOrders: { gt: 1 } } }),
  ]);

  const totalCustomers = totals._count._all;

  return {
    byType: ["NEW", "REGULAR", "LOYAL", "VIP", "INACTIVE"].map((type) => ({
      type,
      count: byType.find((b) => b.customerType === type)?._count._all ?? 0,
    })),
    topCustomers,
    totalCustomers,
    lifetimeValue: new Prisma.Decimal(totals._sum.totalSpent ?? 0),
    repeatCustomers: repeatRate,
    repeatRate: totalCustomers ? Math.round((repeatRate / totalCustomers) * 100) : 0,
  };
}

/** Best-selling items, computed from the immutable order-item snapshots. */
export async function getTopProducts(ctx: TenantContext, days = 30, limit = 10) {
  const since = daysAgo(days);
  const rows = await prisma.orderItem.groupBy({
    by: ["productNameSnapshot"],
    where: {
      restaurantId: ctx.restaurantId,
      createdAt: { gte: since },
      order: { paymentStatus: "SUCCESS", status: { notIn: ["CANCELLED", "FAILED"] } },
    },
    _sum: { quantity: true, total: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: limit,
  });

  return rows.map((r) => ({
    name: r.productNameSnapshot,
    quantity: r._sum.quantity ?? 0,
    revenue: new Prisma.Decimal(r._sum.total ?? 0).toNumber(),
  }));
}

export async function getOrderStatusSummary(ctx: TenantContext, days = 30) {
  const since = daysAgo(days);
  const rows = await prisma.order.groupBy({
    by: ["status"],
    where: { restaurantId: ctx.restaurantId, createdAt: { gte: since } },
    _count: { _all: true },
  });
  return rows.map((r) => ({ status: r.status, count: r._count._all }));
}

/**
 * Conversion funnel across the temporary/permanent boundary — the clearest
 * read on how many conversations actually become business.
 */
export async function getConversionFunnel(ctx: TenantContext, days = 30) {
  const since = daysAgo(days);
  const [conversations, carts, convertedCarts, paidOrders] = await Promise.all([
    prisma.conversationSession.count({ where: { restaurantId: ctx.restaurantId, createdAt: { gte: since } } }),
    prisma.checkoutSession.count({ where: { restaurantId: ctx.restaurantId, createdAt: { gte: since } } }),
    prisma.checkoutSession.count({
      where: { restaurantId: ctx.restaurantId, createdAt: { gte: since }, status: "CONVERTED" },
    }),
    prisma.order.count({
      where: { restaurantId: ctx.restaurantId, createdAt: { gte: since }, paymentStatus: "SUCCESS" },
    }),
  ]);

  return [
    { stage: "Conversations", count: conversations },
    { stage: "Carts started", count: carts },
    { stage: "Checkouts converted", count: convertedCarts },
    { stage: "Paid orders", count: paidOrders },
  ];
}
