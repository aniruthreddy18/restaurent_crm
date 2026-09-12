import type { CustomerType, DeliveryStatus, OrderStatus, PaymentStatus } from "@prisma/client";
import { cn } from "@/lib/cn";
import { humanize } from "@/lib/format";

const base = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap";

/**
 * Order status must be readable at a glance across a room — each stage gets a
 * distinct hue plus a dot, so it survives colour-blindness and cheap monitors.
 */
const ORDER_TONE: Record<OrderStatus, string> = {
  CONFIRMED: "bg-info-soft text-info",
  PREPARING: "bg-warn-soft text-warn",
  READY: "bg-brand-soft text-brand-strong",
  OUT_FOR_DELIVERY: "bg-info-soft text-info",
  DELIVERED: "bg-ok-soft text-ok",
  CANCELLED: "bg-surface-muted text-ink-muted",
  FAILED: "bg-danger-soft text-danger",
};

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span className={cn(base, ORDER_TONE[status], className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {humanize(status)}
    </span>
  );
}

const PAYMENT_TONE: Record<PaymentStatus, string> = {
  PENDING: "bg-warn-soft text-warn",
  SUCCESS: "bg-ok-soft text-ok",
  FAILED: "bg-danger-soft text-danger",
  REFUNDED: "bg-surface-muted text-ink-muted",
};

export function PaymentStatusBadge({ status, className }: { status: PaymentStatus; className?: string }) {
  return <span className={cn(base, PAYMENT_TONE[status], className)}>{humanize(status)}</span>;
}

const CUSTOMER_TONE: Record<CustomerType, string> = {
  NEW: "bg-info-soft text-info",
  REGULAR: "bg-surface-muted text-ink-muted",
  LOYAL: "bg-brand-soft text-brand-strong",
  VIP: "bg-ok-soft text-ok",
  INACTIVE: "bg-surface-muted text-ink-subtle",
};

export function CustomerTypeBadge({ type, className }: { type: CustomerType; className?: string }) {
  return <span className={cn(base, CUSTOMER_TONE[type], className)}>{humanize(type)}</span>;
}

const DELIVERY_TONE: Record<DeliveryStatus, string> = {
  PENDING: "bg-surface-muted text-ink-muted",
  ASSIGNED: "bg-info-soft text-info",
  OUT_FOR_DELIVERY: "bg-warn-soft text-warn",
  DELIVERED: "bg-ok-soft text-ok",
  FAILED: "bg-danger-soft text-danger",
};

export function DeliveryStatusBadge({ status, className }: { status: DeliveryStatus; className?: string }) {
  return <span className={cn(base, DELIVERY_TONE[status], className)}>{humanize(status)}</span>;
}

export function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rating ? "text-brand" : "text-line"} aria-hidden>
          ★
        </span>
      ))}
    </span>
  );
}
