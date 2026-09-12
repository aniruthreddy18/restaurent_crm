import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, toContext } from "@/server/auth/guard";
import { getConversation } from "@/server/modules/conversations/conversation.service";
import { NotFoundError } from "@/server/core/errors";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { CustomerTypeBadge } from "@/components/ui/badges";
import { formatDateTime } from "@/lib/format";
import { formatWhatsAppNumber } from "@/lib/phone";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("conversations:read");
  const { id } = await params;

  let conversation;
  try {
    conversation = await getConversation(toContext(user), id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={formatWhatsAppNumber(conversation.whatsappNumber)}
        description={`${conversation.messages.length} message${conversation.messages.length === 1 ? "" : "s"}`}
        action={
          conversation.customer ? (
            <Link href={`/customers/${conversation.customer.id}`} className="flex items-center gap-2 text-sm hover:underline">
              {conversation.customer.name ?? "Unnamed customer"}
              <CustomerTypeBadge type={conversation.customer.customerType} />
            </Link>
          ) : (
            <span className="rounded-full bg-surface-muted px-3 py-1 text-xs text-ink-muted">
              Not a CRM customer — no payment has completed
            </span>
          )
        }
      />

      <Card className="p-4">
        {conversation.messages.length === 0 ? (
          <EmptyState title="No messages" />
        ) : (
          <ol className="space-y-3">
            {conversation.messages.map((message) => {
              const inbound = message.direction === "INBOUND";
              return (
                <li key={message.id} className={cn("flex", inbound ? "justify-start" : "justify-end")}>
                  <div
                    className={cn(
                      "max-w-[min(34rem,85%)] rounded-2xl px-3.5 py-2.5",
                      inbound ? "bg-surface-muted text-ink" : "bg-brand-soft text-ink",
                    )}
                  >
                    <p className="whitespace-pre-wrap text-sm">{message.message}</p>
                    <p className="mt-1 text-[11px] text-ink-subtle">
                      {inbound ? "Customer" : "Restaurant"} · {formatDateTime(message.createdAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </>
  );
}
