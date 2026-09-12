import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, toContext } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { getOrder, getOrderTimeline } from "@/server/modules/orders/order.service";
import { NotFoundError } from "@/server/core/errors";
import { Card, CardHeader, EmptyState, PageHeader, Td, Th } from "@/components/ui/primitives";
import { CustomerTypeBadge, DeliveryStatusBadge, OrderStatusBadge, PaymentStatusBadge, Stars } from "@/components/ui/badges";
import { OrderStatusActions } from "@/components/orders/order-actions";
import { formatMoney } from "@/lib/money";
import { formatDateTime, humanize } from "@/lib/format";
import { formatWhatsAppNumber } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("orders:read");
  const ctx = toContext(user);
  const { id } = await params;

  let order;
  try {
    order = await getOrder(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { events, audits } = await getOrderTimeline(ctx, order.id);

  const timeline = [
    ...events.map((e) => ({
      at: e.createdAt,
      label: humanize(e.type),
      detail: `Event queued for n8n · ${e.status.toLowerCase()}`,
      kind: "event" as const,
    })),
    ...audits.map((a) => ({
      at: a.createdAt,
      label: humanize(a.action.replace(/\./g, " ")),
      detail: a.user?.name ? `by ${a.user.name}` : `by ${a.actorLabel ?? a.actorType.toLowerCase()}`,
      kind: "audit" as const,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <>
      <PageHeader
        title={order.orderNumber}
        description={`Placed ${formatDateTime(order.createdAt)}`}
        action={
          <OrderStatusActions
            orderId={order.id}
            orderNumber={order.orderNumber}
            status={order.status}
            canAdvance={can(user.role, "orders:status")}
            canCancel={can(user.role, "orders:cancel")}
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <OrderStatusBadge status={order.status} />
        <PaymentStatusBadge status={order.paymentStatus} />
        {order.delivery ? <DeliveryStatusBadge status={order.delivery.status} /> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Items" subtitle="Prices are snapshots taken when the order was placed" />
            <div className="table-scroll">
              <table className="w-full min-w-[460px]">
                <thead className="border-b border-line bg-surface-muted">
                  <tr>
                    <Th>Item</Th>
                    <Th className="text-right">Unit price</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Total</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <Td>
                        <span className="font-medium">{item.productNameSnapshot}</span>
                        {item.notes ? <p className="text-xs text-ink-subtle">{item.notes}</p> : null}
                      </Td>
                      <Td className="text-right tabular-nums text-ink-muted">
                        {formatMoney(item.unitPriceSnapshot, user.currency)}
                      </Td>
                      <Td className="text-right tabular-nums">{item.quantity}</Td>
                      <Td className="text-right tabular-nums font-medium">
                        {formatMoney(item.total, user.currency)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="space-y-1.5 border-t border-line px-5 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Subtotal</dt>
                <dd className="tabular-nums">{formatMoney(order.subtotal, user.currency)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Delivery fee</dt>
                <dd className="tabular-nums">{formatMoney(order.deliveryFee, user.currency)}</dd>
              </div>
              {Number(order.discount) > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Discount</dt>
                  <dd className="tabular-nums text-ok">−{formatMoney(order.discount, user.currency)}</dd>
                </div>
              ) : null}
              {Number(order.tax) > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Tax</dt>
                  <dd className="tabular-nums">{formatMoney(order.tax, user.currency)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(order.totalAmount, user.currency)}</dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Timeline" subtitle="Every state change, from the audit log and event outbox" />
            {timeline.length === 0 ? (
              <EmptyState title="No activity recorded yet" />
            ) : (
              <ol className="space-y-0 px-5 py-4">
                {timeline.map((entry, index) => (
                  <li key={index} className="relative flex gap-3 pb-4 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${entry.kind === "event" ? "bg-brand" : "bg-line"}`}
                        aria-hidden
                      />
                      {index < timeline.length - 1 ? <span className="w-px flex-1 bg-line" aria-hidden /> : null}
                    </div>
                    <div className="-mt-0.5 min-w-0">
                      <p className="text-sm font-medium text-ink">{entry.label}</p>
                      <p className="text-xs text-ink-subtle">
                        {formatDateTime(entry.at)} · {entry.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Customer" />
            <div className="space-y-2 px-5 py-4 text-sm">
              <Link href={`/customers/${order.customer.id}`} className="font-medium text-brand-strong hover:underline">
                {order.customer.name ?? "Unnamed customer"}
              </Link>
              <p className="text-ink-muted">{formatWhatsAppNumber(order.customer.whatsappNumber)}</p>
              <CustomerTypeBadge type={order.customer.customerType} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Delivery" />
            <div className="space-y-2 px-5 py-4 text-sm">
              <p className="text-ink">{order.deliveryAddress ?? "No delivery address — collection order"}</p>
              {order.delivery?.driver ? (
                <p className="text-ink-muted">
                  Driver: {order.delivery.driver.name} · {order.delivery.driver.phone}
                </p>
              ) : order.delivery ? (
                <p className="text-ink-subtle">No driver assigned yet</p>
              ) : null}
              {order.delivery?.deliveredAt ? (
                <p className="text-ink-muted">Delivered {formatDateTime(order.delivery.deliveredAt)}</p>
              ) : null}
            </div>
          </Card>

          {can(user.role, "payments:read") ? (
            <Card>
              <CardHeader title="Payments" />
              {order.payments.length === 0 ? (
                <EmptyState title="No payment recorded" />
              ) : (
                <ul className="divide-y divide-line">
                  {order.payments.map((payment) => (
                    <li key={payment.id} className="px-5 py-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="tabular-nums font-medium">
                          {formatMoney(payment.amount, payment.currency)}
                        </span>
                        <PaymentStatusBadge status={payment.status} />
                      </div>
                      <p className="mt-1 truncate text-xs text-ink-subtle">
                        {payment.gateway ?? "—"} · {payment.transactionId}
                      </p>
                      {payment.failureReason ? (
                        <p className="mt-1 text-xs text-danger">{payment.failureReason}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {order.review ? (
            <Card>
              <CardHeader title="Review" />
              <div className="space-y-2 px-5 py-4">
                <Stars rating={order.review.rating} />
                {order.review.comment ? <p className="text-sm text-ink">{order.review.comment}</p> : null}
                <p className="text-xs text-ink-subtle">{formatDateTime(order.review.createdAt)}</p>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
