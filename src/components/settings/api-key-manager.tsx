"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { buttonClass, Field, inputClass } from "@/components/ui/primitives";
import { ConfirmDialog, Modal } from "@/components/ui/confirm";
import { formatRelative } from "@/lib/format";

type Key = {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

export function ApiKeyManager({ keys, canManage }: { keys: Key[]; canManage: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Key | null>(null);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    setBusy(true);
    try {
      const result = await apiFetch<{ key: string }>("/api/settings/api-keys", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setNewKey(result.key);
      setCreating(false);
      router.refresh();
    } catch (error) {
      push(error instanceof ApiError ? error.message : "Could not create the key.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    try {
      await apiFetch(`/api/settings/api-keys/${revoking.id}`, { method: "DELETE" });
      push(`"${revoking.name}" revoked.`);
      setRevoking(null);
      router.refresh();
    } catch (error) {
      push(error instanceof ApiError ? error.message : "Could not revoke the key.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ul className="divide-y divide-line">
        {keys.length === 0 ? (
          <li className="px-5 py-6 text-center text-sm text-ink-muted">No API keys yet</li>
        ) : (
          keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{key.name}</p>
                <p className="font-mono text-xs text-ink-subtle">
                  {key.keyPrefix}…{" "}
                  {key.lastUsedAt ? `· last used ${formatRelative(key.lastUsedAt)}` : "· never used"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={key.isActive ? "text-xs text-ok" : "text-xs text-ink-subtle"}>
                  {key.isActive ? "Active" : "Revoked"}
                </span>
                {canManage && key.isActive ? (
                  <button type="button" onClick={() => setRevoking(key)} className={buttonClass("ghost", "sm")}>
                    Revoke
                  </button>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ul>

      {canManage ? (
        <div className="border-t border-line px-5 py-3">
          <button type="button" onClick={() => setCreating(true)} className={buttonClass("secondary", "sm")}>
            Create API key
          </button>
        </div>
      ) : null}

      <Modal open={creating} title="Create an API key" onClose={() => setCreating(false)}>
        <form onSubmit={create} className="space-y-3">
          <Field label="Name" hint="Something you will recognise later, e.g. “n8n production”.">
            <input name="name" required maxLength={80} className={inputClass} autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className={buttonClass("secondary", "sm")}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={buttonClass("primary", "sm")}>
              {busy ? "Creating…" : "Create key"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Shown once. Only the SHA-256 digest is stored, so it cannot be re-read. */}
      <Modal open={Boolean(newKey)} title="Copy this key now" onClose={() => setNewKey(null)}>
        <p className="text-sm text-ink-muted">
          This is the only time the key is shown — the CRM stores only a hash of it. Paste it into your n8n HTTP
          Request credential as a bearer token.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface-muted p-3 font-mono text-xs">
          {newKey}
        </pre>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => setNewKey(null)} className={buttonClass("primary", "sm")}>
            Done
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(revoking)}
        title={`Revoke "${revoking?.name}"?`}
        description="Any n8n workflow using this key stops working immediately. This cannot be undone."
        confirmLabel="Revoke key"
        destructive
        busy={busy}
        onConfirm={revoke}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}
