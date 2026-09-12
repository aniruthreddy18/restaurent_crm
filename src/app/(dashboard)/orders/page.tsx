import Link from "next/link";
import { requirePermission, toContext } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { getOrderBoard, listOrders } from "@/server/modules/orders/order.service";
import { listOrdersSchema } from "@/server/modules/orders/order.schema";
import { Card, CardHeader, EmptyState, PageHeader, Td, Th } from "@/components/ui/primitives";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/ui/badges";
import { OrderBoard, type BoardColumnData } from "@/components/orders/order-board";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/table-tools";
import { formatMoney } from "@/lib/money";
import { formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders · Restaurant CRM" };

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("orders:read");
  const ctx = toContext(user);
  const raw = await searchParams;
  const query = listOrdersSchema.parse(raw);

  const [board, list] = await Promise.all([getOrderBoard(ctx), listOrders(ctx, query)]);

  const columns: BoardColumnData[] = board.map((column) => ({
    status: column.status,
    total: column.total,
    orders: column.orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalAmount: order.totalAmount.toString(),
      createdAt: order.createdAt.toISOString(),
      customerName: order.customer.name,
      customerNumber: order.customer.whatsappNumber,
      items: order.items.map((item) => ({ name: item.productNameSnapshot, quantity: item.quantity })),
    })),
  }));

  return (
    <>
      <PageHeader
        title="Orders"
        description="Live kitchen board. Move an order along as the food progresses."
      />

      <OrderBoard columns={columns} currency={user.currency} canChangeStatus={can(user.role, "orders:status")} />

      <Card className="mt-6">
        <CardHeader
          title="All orders"
          subtitle={`${list.meta.total} order${list.meta.total === 1 ? "" : "s"}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                name="status"
                label="Status"
                options={[
                  { value: "CONFIRMED", label: "Confirmed" },
                  { value: "PREPARING", label: "Preparing" },
                  { value: "READY", label: "Ready" },
                  { value: "OUT_FOR_DELIVERY", label: "Out for delivery" },
                  { value: "DELIVERED", label: "Delivered" },
                  { value: "CANCELLED", label: "Cancelled" },
                  { value: "FAILED", label: "Failed" },
                ]}
              />
              <FilterSelect
                name="paymentStatus"
                label="Payment"
                options={[
                  { value: "SUCCESS", label: "Paid" },
                  { value: "PENDING", label: "Pending" },
                  { value: "FAILED", label: "Failed" },
                  { value: "REFUNDED", label: "Refunded" },
                ]}
              />
              <SearchInput placeholder="Order number or customer" />
            </div>
          }
        />

        {list.data.length === 0 ? (
          <EmptyState
            title="No orders match"
            description="Try clearing the filters, or wait for the next paid order to arrive from WhatsApp."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full min-w-[820px]">
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
                  {list.data.map((order) => (
                    <tr key={order.id} className="hover:bg-surface-muted">
                      <Td>
                        <Link href={`/orders/${order.id}`} className="font-medium text-brand-strong hover:underline">
                          {order.orderNumber}
                        </Link>
                      </Td>
                      <Td>
                        <Link href={`/customers/${order.customer.id}`} className="hover:underline">
                          {order.customer.name ?? order.customer.whatsappNumber}
                        </Link>
                      </Td>
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
                      <Td className="whitespace-nowrap text-ink-muted">{formatRelative(order.createdAt)}</Td>
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
