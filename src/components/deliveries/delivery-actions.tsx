"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { buttonClass } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm";

/**
 * [ MARK DELIVERED ] — sized for a phone held in one hand at a doorstep.
 * Confirmed, because it is the irreversible end of the order.
 */
export function MarkDeliveredButton({
  deliveryId,
  orderNumber,
  disabled,
}: {
  deliveryId: string;
  orderNumber: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await apiFetch(`/api/deliveries/${deliveryId}/delivered`, { method: "POST", body: JSON.stringify({}) });
      push(`${orderNumber} delivered. n8n will thank the customer and ask for a rating.`);
      setConfirming(false);
      router.refresh();
    } catch (error) {
      push(error instanceof ApiError ? error.message : "Could not mark it delivered.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={disabled || busy}
        className={buttonClass("primary", "lg", "w-full font-semibold tracking-wide")}
      >
        MARK DELIVERED
      </button>
      <ConfirmDialog
        open={confirming}
        title={`Mark ${orderNumber} delivered?`}
        description="This closes the order and queues the delivery confirmation and rating request for n8n."
        confirmLabel="Yes, delivered"
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

export function DispatchButton({ deliveryId, orderNumber }: { deliveryId: string; orderNumber: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  async function dispatch() {
    setBusy(true);
    try {
      await apiFetch(`/api/deliveries/${deliveryId}/dispatch`, { method: "POST", body: JSON.stringify({}) });
      push(`${orderNumber} is out for delivery.`);
      router.refresh();
    } catch (error) {
      push(error instanceof ApiError ? error.message : "Could not dispatch this order.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={dispatch} disabled={busy} className={buttonClass("secondary", "md", "w-full")}>
      {busy ? "Dispatching…" : "Start delivery"}
    </button>
  );
}

export function AssignDriverSelect({
  deliveryId,
  drivers,
  current,
}: {
  deliveryId: string;
  drivers: { id: string; name: string }[];
  current: string | null;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  async function assign(driverId: string) {
    setBusy(true);
    try {
      await apiFetch(`/api/deliveries/${deliveryId}`, {
        method: "PATCH",
        body: JSON.stringify({ driverId: driverId || null }),
      });
      push(driverId ? "Driver assigned." : "Driver unassigned.");
      router.refresh();
    } catch (error) {
      push(error instanceof ApiError ? error.message : "Could not assign the driver.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      value={current ?? ""}
      disabled={busy}
      onChange={(e) => assign(e.target.value)}
      aria-label="Assign driver"
      className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-brand focus:outline-none"
    >
      <option value="">Unassigned</option>
      {drivers.map((driver) => (
        <option key={driver.id} value={driver.id}>
          {driver.name}
        </option>
      ))}
    </select>
  );
}
