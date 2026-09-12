import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, toContext } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { getCustomerProfile } from "@/server/modules/customers/customer.service";
import { NotFoundError } from "@/server/core/errors";
import { Card, CardHeader, EmptyState, PageHeader, StatTile, Td, Th } from "@/components/ui/primitives";
import {
  CustomerTypeBadge,
  DeliveryStatusBadge,
  OrderStatusBadge,
  PaymentStatusBadge,
  Stars,
} from "@/components/ui/badges";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, humanize } from "@/lib/format";
import { formatWhatsAppNumber } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("customers:read");
  const ctx = toContext(user);
  const { id } = await params;

  let profile;
  try {
    profile = await getCustomerProfile(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { customer, orders, payments, reviews, deliveries, timeline } = profile;

  return (
    <>
      <PageHeader
        title={customer.name ?? "Unnamed customer"}
        description={`${formatWhatsAppNumber(customer.whatsappNumber)}${customer.city ? ` · ${customer.city}` : ""}`}
        action={<CustomerTypeBadge type={customer.customerType} className="text-sm" />}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total orders" value={customer.totalOrders} />
        <StatTile label="Total spent" value={formatMoney(customer.totalSpent, user.currency)} tone="brand" />
        <StatTile label="Avg order value" value={formatMoney(customer.averageOrderValue, user.currency)} />
        <StatTile
          label="Last order"
          value={customer.lastOrderAt ? formatDate(customer.lastOrderAt) : "—"}
          hint={customer.firstOrderAt ? `First: ${formatDate(customer.firstOrderAt)}` : undefined}
        />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Order history" subtitle={`${orders.length} order${orders.length === 1 ? "" : "s"}`} />
            {orders.length === 0 ? (
              <EmptyState title="No orders yet" />
            ) : (
              <div className="table-scroll">
                <table className="w-full min-w-[620px]">
                  <thead className="border-b border-line bg-surface-muted">
                    <tr>
                      <Th>Order</Th>
                      <Th>Items</Th>
                      <Th className="text-right">Amount</Th>
                      <Th>Payment</Th>
                      <Th>Status</Th>
                      <Th>Date</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {orders.map((order) => (
                      <tr key={order.id} className="hover:bg-surface-muted">
                        <Td>
                          <Link href={`/orders/${order.id}`} className="font-medium text-brand-strong hover:underline">
                            {order.orderNumber}
                          </Link>
                        </Td>
                        <Td className="tabular-nums text-ink-muted">
                          {order.items.reduce((sum, i) => sum + i.quantity, 0)}
                        </Td>
                        <Td className="text-right tabular-nums">{formatMoney(order.totalAmount, user.currency)}</Td>
                        <Td>
                          <PaymentStatusBadge status={order.paymentStatus} />
                        </Td>
                        <Td>
                          <OrderStatusBadge status={order.status} />
                        </Td>
                        <Td className="whitespace-nowrap text-ink-muted">{formatDate(order.createdAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Activity timeline" subtitle="Built from the event outbox" />
            {timeline.length === 0 ? (
              <EmptyState title="No activity recorded" />
            ) : (
              <ol className="px-5 py-4">
                {timeline.map((event, index) => (
                  <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
                      {index < timeline.length - 1 ? <span className="w-px flex-1 bg-line" aria-hidden /> : null}
                    </div>
                    <div className="-mt-0.5">
                      <p className="text-sm font-medium text-ink">{humanize(event.type)}</p>
                      <p className="text-xs text-ink-subtle">{formatDateTime(event.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <dl className="space-y-2.5 px-5 py-4 text-sm">
              <div>
                <dt className="text-xs text-ink-subtle">WhatsApp</dt>
                <dd className="tabular-nums">{formatWhatsAppNumber(customer.whatsappNumber)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-subtle">Email</dt>
                <dd>{customer.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-subtle">Address</dt>
                <dd>{customer.address ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-subtle">Customer since</dt>
                <dd>{formatDate(customer.createdAt)}</dd>
              </div>
            </dl>
          </Card>

          {can(user.role, "payments:read") ? (
            <Card>
              <CardHeader title="Payment history" />
              {payments.length === 0 ? (
                <EmptyState title="No payments" />
              ) : (
                <ul className="divide-y divide-line">
                  {payments.slice(0, 8).map((payment) => (
                    <li key={payment.id} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="tabular-nums font-medium">
                          {formatMoney(payment.amount, payment.currency)}
                        </span>
                        <PaymentStatusBadge status={payment.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {payment.paymentMethod ?? "—"} · {formatDate(payment.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Delivery history" />
            {deliveries.length === 0 ? (
              <EmptyState title="No deliveries" />
            ) : (
              <ul className="divide-y divide-line">
                {deliveries.slice(0, 8).map((delivery) => (
                  <li key={delivery.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span className="truncate text-ink-muted">{delivery.deliveryAddress ?? "—"}</span>
                    <DeliveryStatusBadge status={delivery.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Reviews" />
            {reviews.length === 0 ? (
              <EmptyState title="No reviews yet" />
            ) : (
              <ul className="divide-y divide-line">
                {reviews.map((review) => (
                  <li key={review.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <Stars rating={review.rating} />
                      <span className="text-xs text-ink-subtle">{review.order.orderNumber}</span>
                    </div>
                    {review.comment ? <p className="mt-1 text-sm text-ink">{review.comment}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
