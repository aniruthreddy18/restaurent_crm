"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrderStatus } from "@prisma/client";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { buttonClass } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm";
import { humanize } from "@/lib/format";

/**
 * The prominent [ ORDER IS READY ] button.
 *
 * It only sets CRM state and emits ORDER_READY — the WhatsApp message is n8n's
 * job, which is why the confirmation copy says "will be notified", not "sent".
 */
export function OrderReadyButton({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  async function markReady() {
    setBusy(true);
    try {
      await apiFetch(`/api/orders/${orderId}/ready`, { method: "POST" });
      push(`${orderNumber} marked ready. n8n will send the WhatsApp notification.`);
      router.refresh();
    } catch (error) {
      push(error instanceof ApiError ? error.message : "Could not mark the order ready.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={markReady}
      disabled={busy}
      className={buttonClass(
        "primary",
        "lg",
        "w-full font-semibold tracking-wide shadow-sm sm:w-auto sm:min-w-[16rem]",
      )}
    >
      {busy ? "Marking ready…" : "ORDER IS READY"}
    </button>
  );
}

export function OrderStatusActions({
  orderId,
  orderNumber,
  status,
  canAdvance,
  canCancel,
}: {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  canAdvance: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const next: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
    CONFIRMED: { to: "PREPARING", label: "Start preparing" },
    READY: { to: "OUT_FOR_DELIVERY", label: "Send out for delivery" },
    OUT_FOR_DELIVERY: { to: "DELIVERED", label: "Mark delivered" },
  };

  const step = next[status];
  const cancellable = canCancel && !["DELIVERED", "CANCELLED", "FAILED", "OUT_FOR_DELIVERY"].includes(status);

  async function move(to: OrderStatus) {
    setBusy(true);
    try {
      await apiFetch(`/api/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ status: to }) });
      push(`${orderNumber} moved to ${humanize(to)}.`);
      router.refresh();
    } catch (error) {
      push(error instanceof ApiError ? error.message : "Could not update the order.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await apiFetch(`/api/orders/${orderId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "Cancelled from the order screen" }),
      });
      push(`${orderNumber} cancelled.`);
      setConfirmCancel(false);
      router.refresh();
    } catch (error) {
      push(error instanceof ApiError ? error.message : "Could not cancel the order.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canAdvance && status === "PREPARING" ? (
        <OrderReadyButton orderId={orderId} orderNumber={orderNumber} />
      ) : null}

      {canAdvance && step ? (
        <button type="button" onClick={() => move(step.to)} disabled={busy} className={buttonClass("secondary", "md")}>
          {step.label}
        </button>
      ) : null}

      {cancellable ? (
        <button
          type="button"
          onClick={() => setConfirmCancel(true)}
          disabled={busy}
          className={buttonClass("ghost", "md")}
        >
          Cancel order
        </button>
      ) : null}

      <ConfirmDialog
        open={confirmCancel}
        title={`Cancel ${orderNumber}?`}
        description="The order stops counting towards the customer's lifetime value and an ORDER_CANCELLED event is queued for n8n. This cannot be undone."
        confirmLabel="Cancel order"
        destructive
        busy={busy}
        onConfirm={cancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}
