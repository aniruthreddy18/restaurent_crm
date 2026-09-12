"use client";

import { useEffect, useRef } from "react";
import { buttonClass } from "@/components/ui/primitives";

/**
 * Confirmation dialog for anything a tired staff member should not do by
 * accident (cancelling an order, revoking an API key).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={onCancel}
    >
      <div className="card w-full max-w-md p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title" className="text-sm font-semibold text-ink">
          {title}
        </h2>
        {description ? <p className="mt-1.5 text-sm text-ink-muted">{description}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={buttonClass("secondary", "sm")} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={buttonClass(destructive ? "danger" : "primary", "sm")}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/35 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="card w-full max-w-lg p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
