import { requirePermission, toContext } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import {
  getAuditLog,
  getRestaurant,
  listApiKeys,
  listWebhookEndpoints,
} from "@/server/modules/restaurants/restaurant.service";
import { prisma } from "@/server/db/prisma";
import { Card, CardHeader, EmptyState, PageHeader, StatTile, Td, Th } from "@/components/ui/primitives";
import { ApiKeyManager } from "@/components/settings/api-key-manager";
import { formatDateTime, humanize } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Restaurant CRM" };

export default async function SettingsPage() {
  const user = await requirePermission("settings:read");
  const ctx = toContext(user);

  const [restaurant, keys, endpoints, audit, eventStats] = await Promise.all([
    getRestaurant(ctx),
    listApiKeys(ctx),
    listWebhookEndpoints(ctx),
    can(user.role, "audit:read") ? getAuditLog(ctx, 1, 25) : Promise.resolve(null),
    prisma.event.groupBy({
      by: ["status"],
      where: { restaurantId: ctx.restaurantId },
      _count: { _all: true },
    }),
  ]);

  const countFor = (status: string) => eventStats.find((e) => e.status === status)?._count._all ?? 0;

  return (
    <>
      <PageHeader title="Settings" description={`${restaurant.name} · ${restaurant.city ?? "—"}`} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Events pending" value={countFor("PENDING")} tone={countFor("PENDING") > 0 ? "warn" : "default"} />
        <StatTile label="Events delivered" value={countFor("DELIVERED")} tone="ok" />
        <StatTile label="Events failed" value={countFor("FAILED")} />
        <StatTile label="Events dead" value={countFor("DEAD")} tone={countFor("DEAD") > 0 ? "danger" : "default"} />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="API keys"
            subtitle="How n8n authenticates: Authorization: Bearer <key>"
          />
          <ApiKeyManager
            canManage={can(user.role, "settings:write")}
            keys={keys.map((k) => ({
              id: k.id,
              name: k.name,
              keyPrefix: k.keyPrefix,
              isActive: k.isActive,
              lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
              createdAt: k.createdAt.toISOString(),
            }))}
          />
        </Card>

        <Card>
          <CardHeader title="Webhook endpoints" subtitle="Where the CRM pushes events" />
          {endpoints.length === 0 ? (
            <EmptyState
              title="No endpoints configured"
              description="Without one, events stay in the outbox and n8n can poll GET /api/events instead."
            />
          ) : (
            <ul className="divide-y divide-line">
              {endpoints.map((endpoint) => (
                <li key={endpoint.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{endpoint.name}</p>
                    <span className={endpoint.isActive ? "text-xs text-ok" : "text-xs text-ink-subtle"}>
                      {endpoint.isActive ? "Active" : "Disabled"}
                    </span>
                  </div>
                  <p className="mt-0.5 break-all font-mono text-xs text-ink-subtle">{endpoint.url}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {endpoint.eventTypes.length === 0
                      ? "Subscribed to all events"
                      : endpoint.eventTypes.map(humanize).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Business rules" subtitle="Customer tiering thresholds for this restaurant" />
        <dl className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <dt className="text-xs text-ink-subtle">Regular from</dt>
            <dd className="tabular-nums">{restaurant.tiers.regularMinOrders} orders</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Loyal from</dt>
            <dd className="tabular-nums">{restaurant.tiers.loyalMinOrders} orders</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">VIP from</dt>
            <dd className="tabular-nums">{restaurant.tiers.vipMinOrders} orders</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">VIP spend</dt>
            <dd className="tabular-nums">
              {restaurant.currency} {restaurant.tiers.vipMinSpend}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Inactive after</dt>
            <dd className="tabular-nums">{restaurant.tiers.inactiveAfterDays} days</dd>
          </div>
        </dl>
      </Card>

      {audit ? (
        <Card className="mt-4">
          <CardHeader title="Audit log" subtitle={`${audit.total} recorded changes`} />
          {audit.rows.length === 0 ? (
            <EmptyState title="Nothing recorded yet" />
          ) : (
            <div className="table-scroll">
              <table className="w-full min-w-[680px]">
                <thead className="border-b border-line bg-surface-muted">
                  <tr>
                    <Th>When</Th>
                    <Th>Who</Th>
                    <Th>Action</Th>
                    <Th>Entity</Th>
                    <Th>Change</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {audit.rows.map((row) => (
                    <tr key={row.id}>
                      <Td className="whitespace-nowrap text-ink-muted">{formatDateTime(row.createdAt)}</Td>
                      <Td>{row.user?.name ?? row.actorLabel ?? row.actorType.toLowerCase()}</Td>
                      <Td className="font-mono text-xs">{row.action}</Td>
                      <Td className="text-ink-muted">{row.entityType}</Td>
                      <Td className="max-w-sm truncate font-mono text-[11px] text-ink-subtle">
                        {row.oldValue ? `${JSON.stringify(row.oldValue)} → ` : ""}
                        {row.newValue ? JSON.stringify(row.newValue) : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </>
  );
}
