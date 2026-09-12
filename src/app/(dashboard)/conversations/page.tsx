import Link from "next/link";
import { requirePermission, toContext } from "@/server/auth/guard";
import { listConversations } from "@/server/modules/conversations/conversation.service";
import { listConversationsSchema } from "@/server/modules/conversations/conversation.schema";
import { Card, CardHeader, EmptyState, PageHeader, Td, Th } from "@/components/ui/primitives";
import { CustomerTypeBadge } from "@/components/ui/badges";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/table-tools";
import { formatRelative } from "@/lib/format";
import { formatWhatsAppNumber } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conversations · Restaurant CRM" };

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("conversations:read");
  const query = listConversationsSchema.parse(await searchParams);
  const list = await listConversations(toContext(user), query);

  return (
    <>
      <PageHeader
        title="Conversations"
        description="WhatsApp threads logged by n8n. Most of these people are not customers — and chatting never makes them one."
      />

      <Card>
        <CardHeader
          title={`${list.meta.total} thread${list.meta.total === 1 ? "" : "s"}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                name="filter"
                label="Show"
                options={[
                  { value: "customers", label: "Customers only" },
                  { value: "prospects", label: "Not yet customers" },
                ]}
              />
              <SearchInput placeholder="Number or name" />
            </div>
          }
        />

        {list.data.length === 0 ? (
          <EmptyState
            title="No conversations"
            description="Threads appear as soon as n8n starts posting messages to POST /api/messages."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="w-full min-w-[720px]">
                <thead className="border-b border-line bg-surface-muted">
                  <tr>
                    <Th>WhatsApp</Th>
                    <Th>Customer</Th>
                    <Th>Last message</Th>
                    <Th className="text-right">Messages</Th>
                    <Th>Updated</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.data.map((conversation) => (
                    <tr key={conversation.id} className="hover:bg-surface-muted">
                      <Td>
                        <Link
                          href={`/conversations/${conversation.id}`}
                          className="font-medium tabular-nums text-brand-strong hover:underline"
                        >
                          {formatWhatsAppNumber(conversation.whatsappNumber)}
                        </Link>
                      </Td>
                      <Td>
                        {conversation.customer ? (
                          <span className="flex items-center gap-2">
                            <Link href={`/customers/${conversation.customer.id}`} className="hover:underline">
                              {conversation.customer.name ?? "Unnamed"}
                            </Link>
                            <CustomerTypeBadge type={conversation.customer.customerType} />
                          </span>
                        ) : (
                          <span className="text-xs text-ink-subtle">Not a customer yet</span>
                        )}
                      </Td>
                      <Td className="max-w-sm truncate text-ink-muted">
                        {conversation.messages[0]?.message ?? "—"}
                      </Td>
                      <Td className="text-right tabular-nums">{conversation._count.messages}</Td>
                      <Td className="whitespace-nowrap text-ink-muted">
                        {formatRelative(conversation.lastMessageAt)}
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
