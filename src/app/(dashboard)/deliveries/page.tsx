import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, toContext } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { listDeliveries, listDrivers } from "@/server/modules/deliveries/delivery.service";
import { listDeliveriesSchema } from "@/server/modules/deliveries/delivery.schema";
import { Card, CardHeader, EmptyState, PageHeader, Td, Th } from "@/components/ui/primitives";
import { DeliveryStatusBadge } from "@/components/ui/badges";
import { AssignDriverSelect, DispatchButton, MarkDeliveredButton } from "@/components/deliveries/delivery-actions";
import { FilterSelect, Pagination } from "@/components/ui/table-tools";
import { formatMoney } from "@/lib/money";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deliveries · Restaurant CRM" };

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  // Drivers get their own screen; this one is for managers.
  if (!can(user.role, "deliveries:read")) redirect("/deliveries/mine");

  const ctx = toContext(user);
  const query = listDeliveriesSchema.parse(await searchParams);
  const [list, drivers] = await Promise.all([listDeliveries(ctx, query), listDrivers(ctx)]);

  return (
    <>
      <PageHeader
        title="Deliveries"
        description="Assign a driver, dispatch when the food is ready, and close the order on arrival."
      />

      <Card>
        <CardHeader
          title={`${list.meta.total} deliver${list.meta.total === 1 ? "y" : "ies"}`}
          action={
            <FilterSelect
              name="status"
              label="Status"
              options={[
                { value: "PENDING", label: "Pending" },
                { value: "ASSIGNED", label: "Assigned" },
                { value: "OUT_FOR_DELIVERY", label: "Out for delivery" },
                { value: "DELIVERED", label: "Delivered" },
                { value: "FAILED", label: "Failed" },
              ]}
            />
          }
        />

        {list.data.length === 0 ? (
          <EmptyState
            title="No deliveries"
            description="A delivery is created automatically when a paid order has a delivery address."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full min-w-[900px]">
                <thead className="border-b border-line bg-surface-muted">
                  <tr>
                    <Th>Order</Th>
                    <Th>Customer</Th>
                    <Th>Address</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Driver</Th>
                    <Th>Status</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.data.map((delivery) => (
                    <tr key={delivery.id} className="hover:bg-surface-muted">
                      <Td>
                        <Link href={`/orders/${delivery.order.id}`} className="font-medium text-brand-strong hover:underline">
                          {delivery.order.orderNumber}
                        </Link>
                        <p className="text-xs text-ink-subtle">{formatRelative(delivery.order.createdAt)}</p>
                      </Td>
                      <Td>
                        {delivery.order.customer.name ?? delivery.order.customer.whatsappNumber}
                        <p className="text-xs text-ink-subtle">{delivery.order.customer.phone ?? ""}</p>
                      </Td>
                      <Td className="max-w-[16rem] text-ink-muted">{delivery.deliveryAddress ?? "—"}</Td>
                      <Td className="text-right tabular-nums">
                        {formatMoney(delivery.order.totalAmount, user.currency)}
                      </Td>
                      <Td className="w-44">
                        {can(user.role, "deliveries:write") ? (
                          <AssignDriverSelect
                            deliveryId={delivery.id}
                            drivers={drivers.map((d) => ({ id: d.id, name: d.name }))}
                            current={delivery.driverId}
                          />
                        ) : (
                          (delivery.driver?.name ?? "—")
                        )}
                      </Td>
                      <Td>
                        <DeliveryStatusBadge status={delivery.status} />
                      </Td>
                      <Td className="w-44">
                        {delivery.order.status === "READY" ? (
                          <DispatchButton deliveryId={delivery.id} orderNumber={delivery.order.orderNumber} />
                        ) : delivery.order.status === "OUT_FOR_DELIVERY" ? (
                          <MarkDeliveredButton deliveryId={delivery.id} orderNumber={delivery.order.orderNumber} />
                        ) : (
                          <span className="text-xs text-ink-subtle">
                            {delivery.status === "DELIVERED" ? "Completed" : "Waiting on the kitchen"}
                          </span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.meta.page} pageSize={list.meta.pageSize} total={list.meta.total} />
          </>
        )}
      </Card>
    </>
  );
}
