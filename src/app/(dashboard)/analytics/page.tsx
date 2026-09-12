import { requirePermission, toContext } from "@/server/auth/guard";
import {
  getConversionFunnel,
  getCustomerStats,
  getOrderStatusSummary,
  getRevenueSeries,
  getTopProducts,
} from "@/server/modules/analytics/analytics.service";
import { Card, CardHeader, EmptyState, PageHeader, StatTile, Td, Th } from "@/components/ui/primitives";
import { CustomerTypeBadge } from "@/components/ui/badges";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { CategoryBarChart, DonutChart, HorizontalBarChart } from "@/components/charts/simple-charts";
import { formatMoney } from "@/lib/money";
import { humanize } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics · Restaurant CRM" };

export default async function AnalyticsPage() {
  const user = await requirePermission("analytics:read");
  const ctx = toContext(user);

  const [revenue, customers, products, statuses, funnel] = await Promise.all([
    getRevenueSeries(ctx, 30),
    getCustomerStats(ctx),
    getTopProducts(ctx, 30),
    getOrderStatusSummary(ctx, 30),
    getConversionFunnel(ctx, 30),
  ]);

  const monthRevenue = revenue.reduce((sum, d) => sum + d.revenue, 0);
  const monthOrders = revenue.reduce((sum, d) => sum + d.orders, 0);

  return (
    <>
      <PageHeader title="Analytics" description="Last 30 days" />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Revenue (30d)" value={formatMoney(monthRevenue, user.currency)} tone="brand" />
        <StatTile label="Paid orders (30d)" value={monthOrders} />
        <StatTile label="Total customers" value={customers.totalCustomers} />
        <StatTile
          label="Repeat rate"
          value={`${customers.repeatRate}%`}
          hint={`${customers.repeatCustomers} ordered more than once`}
        />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Revenue" subtitle="Paid orders per day" />
          <RevenueChart data={revenue} currency={user.currency} />
        </Card>

        <Card>
          <CardHeader title="Customer mix" subtitle="By tier" />
          {customers.totalCustomers === 0 ? (
            <EmptyState title="No customers yet" />
          ) : (
            <DonutChart data={customers.byType.map((t) => ({ label: humanize(t.type), value: t.count }))} />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Best sellers" subtitle="By quantity, from order snapshots" />
          {products.length === 0 ? (
            <EmptyState title="No sales yet" />
          ) : (
            <HorizontalBarChart data={products.map((p) => ({ name: p.name, value: p.quantity }))} />
          )}
        </Card>

        <Card>
          <CardHeader title="Order outcomes" subtitle="Every order placed in the period" />
          {statuses.length === 0 ? (
            <EmptyState title="No orders yet" />
          ) : (
            <CategoryBarChart
              data={statuses.map((s) => ({ label: humanize(s.status), count: s.count }))}
              labelKey="label"
            />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Conversion funnel"
            subtitle="How many WhatsApp conversations become paid business"
          />
          <div className="space-y-2.5 px-5 py-4">
            {funnel.map((stage, index) => {
              const top = funnel[0].count || 1;
              const pct = Math.round((stage.count / top) * 100);
              return (
                <div key={stage.stage}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink">{stage.stage}</span>
                    <span className="tabular-nums font-medium text-ink">
                      {stage.count}
                      {index > 0 ? <span className="ml-2 text-xs text-ink-subtle">{pct}%</span> : null}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Top customers" subtitle="By lifetime spend" />
          {customers.topCustomers.length === 0 ? (
            <EmptyState title="No customers yet" />
          ) : (
            <div className="table-scroll">
              <table className="w-full min-w-[420px]">
                <thead className="border-b border-line bg-surface-muted">
                  <tr>
                    <Th>Customer</Th>
                    <Th>Tier</Th>
                    <Th className="text-right">Orders</Th>
                    <Th className="text-right">Spent</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {customers.topCustomers.map((customer) => (
                    <tr key={customer.id}>
                      <Td className="font-medium">{customer.name ?? customer.whatsappNumber}</Td>
                      <Td>
                        <CustomerTypeBadge type={customer.customerType} />
                      </Td>
                      <Td className="text-right tabular-nums">{customer.totalOrders}</Td>
                      <Td className="text-right tabular-nums font-medium">
                        {formatMoney(customer.totalSpent, user.currency)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
