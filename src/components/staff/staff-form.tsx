"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { buttonClass, Field, inputClass } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/confirm";

const ROLES = ["ADMIN", "MANAGER", "KITCHEN", "CASHIER", "DELIVERY"] as const;

export function AddStaffButton() {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/staff", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          role: form.get("role"),
          phone: form.get("phone") || undefined,
          vehicle: form.get("vehicle") || undefined,
        }),
      });
      push("Staff member added.");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add the staff member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("primary", "md")}>
        Add staff
      </button>

      <Modal open={open} title="Add a staff member" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Full name">
            <input name="name" required maxLength={120} className={inputClass} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" required className={inputClass} />
          </Field>
          <Field label="Temporary password" hint="At least 8 characters. They should change it after signing in.">
            <input name="password" type="password" required minLength={8} className={inputClass} />
          </Field>
          <Field label="Role">
            <select name="role" required defaultValue="KITCHEN" className={inputClass}>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phone (optional)">
            <input name="phone" maxLength={24} className={inputClass} />
          </Field>
          <Field label="Vehicle (delivery staff only)">
            <input name="vehicle" maxLength={60} className={inputClass} />
          </Field>

          {error ? (
            <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary", "sm")}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={buttonClass("primary", "sm")}>
              {busy ? "Adding…" : "Add staff"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ToggleStaffActive({
  userId,
  name,
  isActive,
}: {
  userId: string;
  name: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await apiFetch(`/api/staff/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !isActive }),
      });
      push(`${name} ${isActive ? "deactivated" : "reactivated"}.`);
      router.refresh();
    } catch (error) {
      push(error instanceof ApiError ? error.message : "Could not update this account.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={toggle} disabled={busy} className={buttonClass(isActive ? "ghost" : "secondary", "sm")}>
      {isActive ? "Deactivate" : "Reactivate"}
    </button>
  );
}
