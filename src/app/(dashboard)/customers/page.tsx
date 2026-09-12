import Link from "next/link";
import { requirePermission, toContext } from "@/server/auth/guard";
import { listCustomers } from "@/server/modules/customers/customer.service";
import { listCustomersSchema } from "@/server/modules/customers/customer.schema";
import { Card, CardHeader, EmptyState, PageHeader, Td, Th } from "@/components/ui/primitives";
import { CustomerTypeBadge } from "@/components/ui/badges";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/table-tools";
import { formatMoney } from "@/lib/money";
import { formatRelative } from "@/lib/format";
import { formatWhatsAppNumber } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customers · Restaurant CRM" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("customers:read");
  const query = listCustomersSchema.parse(await searchParams);
  const list = await listCustomers(toContext(user), query);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Permanent records. A customer appears here only after a payment reached SUCCESS or FAILED."
      />

      <Card>
        <CardHeader
          title={`${list.meta.total} customer${list.meta.total === 1 ? "" : "s"}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                name="customerType"
                label="Type"
                options={[
                  { value: "NEW", label: "New" },
                  { value: "REGULAR", label: "Regular" },
                  { value: "LOYAL", label: "Loyal" },
                  { value: "VIP", label: "VIP" },
                  { value: "INACTIVE", label: "Inactive" },
                ]}
              />
              <FilterSelect
                name="sort"
                label="Sort"
                options={[
                  { value: "recent", label: "Most recent" },
                  { value: "spend", label: "Highest spend" },
                  { value: "orders", label: "Most orders" },
                  { value: "name", label: "Name" },
                ]}
              />
              <SearchInput placeholder="Name, number or email" />
            </div>
          }
        />

        {list.data.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="People who chat, browse the menu or abandon a cart never appear here — only a terminal payment creates a customer."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full min-w-[780px]">
                <thead className="border-b border-line bg-surface-muted">
                  <tr>
                    <Th>Customer</Th>
                    <Th>WhatsApp</Th>
                    <Th>Type</Th>
                    <Th className="text-right">Orders</Th>
                    <Th className="text-right">Total spent</Th>
                    <Th className="text-right">Avg order</Th>
                    <Th>Last order</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.data.map((customer) => (
                    <tr key={customer.id} className="hover:bg-surface-muted">
                      <Td>
                        <Link href={`/customers/${customer.id}`} className="font-medium text-brand-strong hover:underline">
                          {customer.name ?? "Unnamed"}
                        </Link>
                        {customer.city ? <p className="text-xs text-ink-subtle">{customer.city}</p> : null}
                      </Td>
                      <Td className="tabular-nums text-ink-muted">
                        {formatWhatsAppNumber(customer.whatsappNumber)}
                      </Td>
                      <Td>
                        <CustomerTypeBadge type={customer.customerType} />
                      </Td>
                      <Td className="text-right tabular-nums">{customer.totalOrders}</Td>
                      <Td className="text-right tabular-nums font-medium">
                        {formatMoney(customer.totalSpent, user.currency)}
                      </Td>
                      <Td className="text-right tabular-nums text-ink-muted">
                        {formatMoney(customer.averageOrderValue, user.currency)}
                      </Td>
                      <Td className="whitespace-nowrap text-ink-muted">{formatRelative(customer.lastOrderAt)}</Td>
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
