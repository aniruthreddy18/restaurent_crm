"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { OrderStatus } from "@prisma/client";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { buttonClass } from "@/components/ui/primitives";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/ui/badges";
import { formatRelative, humanize } from "@/lib/format";
import { cn } from "@/lib/cn";

export type BoardOrder = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: "PENDING" | "SUCCESS" | "FAILED" | "REFUNDED";
  totalAmount: string;
  createdAt: string;
  customerName: string | null;
  customerNumber: string;
  items: { name: string; quantity: number }[];
};

export type BoardColumnData = { status: OrderStatus; orders: BoardOrder[]; total: number };

/** The action that moves an order out of each column. */
const NEXT_STEP: Partial<Record<OrderStatus, { to: OrderStatus; label: string; emphasis?: boolean }>> = {
  CONFIRMED: { to: "PREPARING", label: "Start preparing" },
  PREPARING: { to: "READY", label: "ORDER IS READY", emphasis: true },
  READY: { to: "OUT_FOR_DELIVERY", label: "Send out for delivery" },
  OUT_FOR_DELIVERY: { to: "DELIVERED", label: "Mark delivered" },
};

const COLUMN_ACCENT: Record<string, string> = {
  CONFIRMED: "border-t-info",
  PREPARING: "border-t-warn",
  READY: "border-t-brand",
  OUT_FOR_DELIVERY: "border-t-info",
  DELIVERED: "border-t-ok",
};

export function OrderBoard({
  columns,
  currency,
  canChangeStatus,
}: {
  columns: BoardColumnData[];
  currency: string;
  canChangeStatus: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const money = (value: string) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value));

  async function advance(order: BoardOrder, to: OrderStatus) {
    setPendingId(order.id);
    try {
      // READY has its own endpoint so the audit trail records the intent.
      if (to === "READY") {
        await apiFetch(`/api/orders/${order.id}/ready`, { method: "POST" });
        push(`${order.orderNumber} is ready — n8n will notify the customer.`);
      } else {
        await apiFetch(`/api/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ status: to }) });
        push(`${order.orderNumber} moved to ${humanize(to)}.`);
      }
      startTransition(() => router.refresh());
    } catch (error) {
      push(error instanceof ApiError ? error.message : "Could not update the order.", "error");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="table-scroll -mx-1 pb-2">
      <div className="flex min-w-[1100px] gap-3 px-1">
        {columns.map((column) => {
          const step = NEXT_STEP[column.status];
          return (
            <section
              key={column.status}
              aria-label={humanize(column.status)}
              className={cn("flex w-[15rem] shrink-0 flex-col rounded-xl border border-line border-t-4 bg-surface-muted/60", COLUMN_ACCENT[column.status])}
            >
              <header className="flex items-center justify-between px-3 py-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-ink">
                  {humanize(column.status)}
                </h2>
                <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium tabular-nums text-ink-muted">
                  {column.total}
                </span>
              </header>

              <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                {column.orders.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-ink-subtle">Nothing here</p>
                ) : (
                  column.orders.map((order) => (
                    <article key={order.id} className="card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={`/orders/${order.id}`}
                          className="text-sm font-semibold text-brand-strong hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                        <span className="text-sm font-medium tabular-nums text-ink">
                          {money(order.totalAmount)}
                        </span>
                      </div>

                      <p className="mt-1 truncate text-sm text-ink">
                        {order.customerName ?? order.customerNumber}
                      </p>

                      <ul className="mt-1.5 space-y-0.5">
                        {order.items.slice(0, 3).map((item, index) => (
                          <li key={index} className="truncate text-xs text-ink-muted">
                            {item.quantity}× {item.name}
                          </li>
                        ))}
                        {order.items.length > 3 ? (
                          <li className="text-xs text-ink-subtle">+{order.items.length - 3} more</li>
                        ) : null}
                      </ul>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <PaymentStatusBadge status={order.paymentStatus} />
                        <span className="text-xs text-ink-subtle">{formatRelative(order.createdAt)}</span>
                      </div>

                      {canChangeStatus && step ? (
                        <button
                          type="button"
                          onClick={() => advance(order, step.to)}
                          disabled={pendingId === order.id}
                          className={buttonClass(step.emphasis ? "primary" : "secondary", "sm", "mt-2.5 w-full")}
                        >
                          {pendingId === order.id ? "Working…" : step.label}
                        </button>
                      ) : null}

                      {!canChangeStatus ? (
                        <div className="mt-2.5">
                          <OrderStatusBadge status={order.status} />
                        </div>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
