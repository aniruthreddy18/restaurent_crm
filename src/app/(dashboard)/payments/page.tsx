import Link from "next/link";
import { requirePermission, toContext } from "@/server/auth/guard";
import { listPayments } from "@/server/modules/payments/payment.service";
import { listPaymentsSchema } from "@/server/modules/payments/payment.schema";
import { Card, CardHeader, EmptyState, PageHeader, Td, Th } from "@/components/ui/primitives";
import { PaymentStatusBadge } from "@/components/ui/badges";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/table-tools";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments · Restaurant CRM" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("payments:read");
  const query = listPaymentsSchema.parse(await searchParams);
  const list = await listPayments(toContext(user), query);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Payment metadata only — no card numbers, CVV or credentials are ever stored."
      />

      <Card>
        <CardHeader
          title={`${list.meta.total} payment${list.meta.total === 1 ? "" : "s"}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                name="status"
                label="Status"
                options={[
                  { value: "SUCCESS", label: "Success" },
                  { value: "PENDING", label: "Pending" },
                  { value: "FAILED", label: "Failed" },
                  { value: "REFUNDED", label: "Refunded" },
                ]}
              />
              <SearchInput placeholder="Transaction or order number" />
            </div>
          }
        />

        {list.data.length === 0 ? (
          <EmptyState title="No payments recorded" />
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full min-w-[860px]">
                <thead className="border-b border-line bg-surface-muted">
                  <tr>
                    <Th>Transaction</Th>
                    <Th>Order</Th>
                    <Th>Customer</Th>
                    <Th>Method</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Status</Th>
                    <Th>Date</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.data.map((payment) => (
                    <tr key={payment.id} className="hover:bg-surface-muted">
                      <Td className="max-w-[14rem] truncate font-mono text-xs">{payment.transactionId}</Td>
                      <Td>
                        {payment.order ? (
                          <Link href={`/orders/${payment.order.id}`} className="font-medium text-brand-strong hover:underline">
                            {payment.order.orderNumber}
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-subtle">No order — payment not completed</span>
                        )}
                      </Td>
                      <Td>
                        {payment.customer ? (
                          <Link href={`/customers/${payment.customer.id}`} className="hover:underline">
                            {payment.customer.name ?? payment.customer.whatsappNumber}
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-subtle">—</span>
                        )}
                      </Td>
                      <Td className="text-ink-muted">
                        {payment.paymentMethod ?? "—"}
                        {payment.gateway ? <p className="text-xs text-ink-subtle">{payment.gateway}</p> : null}
                      </Td>
                      <Td className="text-right tabular-nums font-medium">
                        {formatMoney(payment.amount, payment.currency)}
                      </Td>
                      <Td>
                        <PaymentStatusBadge status={payment.status} />
                        {payment.failureReason ? (
                          <p className="mt-1 max-w-[12rem] truncate text-xs text-danger">{payment.failureReason}</p>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap text-ink-muted">{formatDateTime(payment.createdAt)}</Td>
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
