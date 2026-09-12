import Link from "next/link";
import { requireUser, toContext } from "@/server/auth/guard";
import { getDashboardSummary, getRevenueSeries } from "@/server/modules/analytics/analytics.service";
import { Card, CardHeader, EmptyState, PageHeader, StatTile, Td, Th } from "@/components/ui/primitives";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/ui/badges";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { formatMoney } from "@/lib/money";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard · Restaurant CRM" };

export default async function DashboardPage() {
  const user = await requireUser();
  const ctx = toContext(user);

  const [summary, revenue] = await Promise.all([getDashboardSummary(ctx), getRevenueSeries(ctx, 14)]);

  return (
    <>
      <PageHeader
        title={`Good day, ${user.name.split(" ")[0]}`}
        description={`Today at ${user.restaurantName}`}
      />

      <section aria-label="Today" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Orders today" value={summary.ordersToday} />
        <StatTile
          label="Revenue today"
          value={formatMoney(summary.revenueToday, user.currency)}
          tone="brand"
        />
        <StatTile label="New customers" value={summary.newCustomersToday} hint="Created by a paid or failed payment" />
        <StatTile
          label="Avg order value"
          value={formatMoney(summary.averageOrderValue, user.currency)}
        />
      </section>

      <section aria-label="Order pipeline" className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Confirmed" value={summary.confirmed} />
        <StatTile label="Preparing" value={summary.preparing} tone="warn" />
        <StatTile label="Ready" value={summary.ready} tone="brand" />
        <StatTile label="Out for delivery" value={summary.outForDelivery} />
        <StatTile label="Delivered today" value={summary.deliveredToday} tone="ok" />
      </section>

      <section aria-label="Attention" className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Pending payments"
          value={summary.pendingPayments}
          tone={summary.pendingPayments > 0 ? "warn" : "default"}
          hint="No customer created yet"
        />
        <StatTile
          label="Failed payments today"
          value={summary.failedPaymentsToday}
          tone={summary.failedPaymentsToday > 0 ? "danger" : "default"}
        />
        <StatTile label="Active carts" value={summary.activeCarts} hint="Temporary — not CRM data" />
        <StatTile
          label="Average rating"
          value={summary.averageRating ? `${summary.averageRating} ★` : "—"}
          hint={`${summary.totalReviews} review${summary.totalReviews === 1 ? "" : "s"}`}
        />
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Revenue" subtitle="Paid orders, last 14 days" />
          <RevenueChart data={revenue} currency={user.currency} />
        </Card>

        <Card>
          <CardHeader
            title="Recent orders"
            action={
              <Link href="/orders" className="text-xs font-medium text-brand-strong hover:underline">
                View board
              </Link>
            }
          />
          {summary.recentOrders.length === 0 ? (
            <EmptyState title="No orders yet" description="Orders appear here once a payment succeeds." />
          ) : (
            <ul className="divide-y divide-line">
              {summary.recentOrders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/orders/${order.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-muted"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {order.customer.name ?? order.customer.whatsappNumber}
                      </p>
                      <p className="text-xs text-ink-subtle">
                        {order.orderNumber} · {formatRelative(order.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-medium tabular-nums text-ink">
                        {formatMoney(order.totalAmount, user.currency)}
                      </span>
                      <OrderStatusBadge status={order.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Latest activity" subtitle="Most recent orders across every status" />
        <div className="table-scroll">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-line bg-surface-muted">
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Items</Th>
                <Th>Amount</Th>
                <Th>Payment</Th>
                <Th>Status</Th>
                <Th>Placed</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.recentOrders.map((order) => (
                <tr key={order.id} className="hover:bg-surface-muted">
                  <Td>
                    <Link href={`/orders/${order.id}`} className="font-medium text-brand-strong hover:underline">
                      {order.orderNumber}
                    </Link>
                  </Td>
                  <Td>{order.customer.name ?? order.customer.whatsappNumber}</Td>
                  <Td className="tabular-nums text-ink-muted">
                    {order.items.reduce((sum, i) => sum + i.quantity, 0)}
                  </Td>
                  <Td className="tabular-nums">{formatMoney(order.totalAmount, user.currency)}</Td>
                  <Td>
                    <PaymentStatusBadge status={order.paymentStatus} />
                  </Td>
                  <Td>
                    <OrderStatusBadge status={order.status} />
                  </Td>
                  <Td className="text-ink-muted">{formatRelative(order.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summary.recentOrders.length === 0 ? <EmptyState title="Nothing here yet" /> : null}
      </Card>
    </>
  );
}
