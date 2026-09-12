import { requireUser, toContext } from "@/server/auth/guard";
import { listDeliveries } from "@/server/modules/deliveries/delivery.service";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DeliveryStatusBadge } from "@/components/ui/badges";
import { DispatchButton, MarkDeliveredButton } from "@/components/deliveries/delivery-actions";
import { formatMoney } from "@/lib/money";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "My deliveries · Restaurant CRM" };

/**
 * The driver's screen. Deliberately a short list of big cards rather than a
 * table — it is used on a phone, outdoors, one-handed.
 */
export default async function MyDeliveriesPage() {
  const user = await requireUser();
  const list = await listDeliveries(toContext(user), { page: 1, pageSize: 50, scope: "me" });

  const active = list.data.filter((d) => d.status !== "DELIVERED" && d.status !== "FAILED");
  const done = list.data.filter((d) => d.status === "DELIVERED" || d.status === "FAILED");

  return (
    <>
      <PageHeader title="My deliveries" description="Orders assigned to you" />

      {active.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing to deliver right now"
            description="Assigned orders appear here as soon as the kitchen marks them ready."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {active.map((delivery) => (
            <Card key={delivery.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink">{delivery.order.orderNumber}</p>
                  <p className="text-xs text-ink-subtle">{formatRelative(delivery.order.createdAt)}</p>
                </div>
                <DeliveryStatusBadge status={delivery.status} />
              </div>

              <p className="mt-3 text-sm font-medium text-ink">
                {delivery.order.customer.name ?? delivery.order.customer.whatsappNumber}
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">{delivery.deliveryAddress ?? "No address recorded"}</p>

              <p className="mt-3 text-lg font-semibold tabular-nums text-ink">
                {formatMoney(delivery.order.totalAmount, user.currency)}
                <span className="ml-2 text-xs font-normal text-ink-subtle">
                  {delivery.order.paymentStatus === "SUCCESS" ? "Paid online" : "Collect payment"}
                </span>
              </p>

              <ul className="mt-2 space-y-0.5">
                {delivery.order.items.slice(0, 4).map((item, index) => (
                  <li key={index} className="truncate text-xs text-ink-muted">
                    {item.quantity}× {item.productNameSnapshot}
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                {delivery.order.status === "READY" ? (
                  <DispatchButton deliveryId={delivery.id} orderNumber={delivery.order.orderNumber} />
                ) : delivery.order.status === "OUT_FOR_DELIVERY" ? (
                  <MarkDeliveredButton deliveryId={delivery.id} orderNumber={delivery.order.orderNumber} />
                ) : (
                  <p className="text-center text-xs text-ink-subtle">Waiting for the kitchen</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {done.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink">Completed</h2>
          <Card>
            <ul className="divide-y divide-line">
              {done.slice(0, 20).map((delivery) => (
                <li key={delivery.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{delivery.order.orderNumber}</p>
                    <p className="truncate text-xs text-ink-subtle">{delivery.deliveryAddress ?? "—"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-ink-subtle">{formatRelative(delivery.deliveredAt)}</span>
                    <DeliveryStatusBadge status={delivery.status} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </>
  );
}
