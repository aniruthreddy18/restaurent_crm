"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

/** Kitchen staff flip this all shift; it is the one menu control they own. */
export function AvailabilityToggle({
  productId,
  name,
  available,
  disabled,
}: {
  productId: string;
  name: string;
  available: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState(available);

  async function toggle() {
    const next = !optimistic;
    setOptimistic(next);
    setBusy(true);
    try {
      await apiFetch(`/api/menu/products/${productId}`, {
        method: "PATCH",
        body: JSON.stringify({ isAvailable: next }),
      });
      push(`${name} is now ${next ? "available" : "sold out"}.`);
      router.refresh();
    } catch (error) {
      // Roll the optimistic flip back so the switch never lies.
      setOptimistic(!next);
      push(error instanceof ApiError ? error.message : "Could not update availability.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={optimistic}
      aria-label={`${name} availability`}
      onClick={toggle}
      disabled={disabled || busy}
      className={cn(
        "inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50",
        optimistic ? "bg-ok" : "bg-line",
      )}
    >
      <span
        className={cn(
          "h-5 w-5 rounded-full bg-white shadow transition-transform",
          optimistic ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
