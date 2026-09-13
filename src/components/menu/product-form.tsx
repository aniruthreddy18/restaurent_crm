"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { buttonClass, Field, inputClass } from "@/components/ui/primitives";
import { ConfirmDialog, Modal } from "@/components/ui/confirm";

export type CategoryOption = { id: string; name: string };

export type EditableProduct = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  sku: string | null;
  preparationTime: number | null;
  categoryId: string | null;
  isAvailable: boolean;
};

/** Pulls the field-level messages out of a 422 so the user sees what to fix. */
function describeError(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  const { details } = error;
  if (Array.isArray(details) && details.length) {
    return details.map((d: { path?: string; message?: string }) => `${d.path}: ${d.message}`).join(" · ");
  }
  return error.message || fallback;
}

function ProductFields({ product, categories }: { product?: EditableProduct; categories: CategoryOption[] }) {
  return (
    <>
      <Field label="Name">
        <input name="name" required maxLength={160} defaultValue={product?.name} className={inputClass} autoFocus />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Price" hint="Per unit, before any delivery fee.">
          <input
            name="price"
            type="number"
            required
            min={0}
            step="0.01"
            defaultValue={product?.price}
            className={inputClass}
          />
        </Field>

        <Field label="Category">
          <select name="categoryId" defaultValue={product?.categoryId ?? ""} className={inputClass}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Description (optional)">
        <textarea
          name="description"
          rows={2}
          maxLength={1000}
          defaultValue={product?.description ?? ""}
          className={inputClass}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="SKU (optional)" hint="Your own code, e.g. CK-001.">
          <input name="sku" maxLength={60} defaultValue={product?.sku ?? ""} className={inputClass} />
        </Field>

        <Field label="Prep time (minutes, optional)">
          <input
            name="preparationTime"
            type="number"
            min={0}
            max={600}
            defaultValue={product?.preparationTime ?? ""}
            className={inputClass}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          name="isAvailable"
          type="checkbox"
          defaultChecked={product?.isAvailable ?? true}
          className="h-4 w-4 rounded border-line"
        />
        Available to order
      </label>
    </>
  );
}

/** Shared form → API payload mapping, so add and edit cannot drift apart. */
function readForm(form: FormData) {
  const optional = (key: string) => {
    const value = String(form.get(key) ?? "").trim();
    return value === "" ? undefined : value;
  };

  return {
    name: String(form.get("name") ?? "").trim(),
    price: Number(form.get("price") ?? 0),
    categoryId: optional("categoryId") ?? null,
    description: optional("description"),
    sku: optional("sku"),
    preparationTime: optional("preparationTime") ? Number(form.get("preparationTime")) : undefined,
    isAvailable: form.get("isAvailable") === "on",
  };
}

export function AddProductButton({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = readForm(new FormData(event.currentTarget));
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/menu/products", { method: "POST", body: JSON.stringify(body) });
      push(`"${body.name}" added to the menu.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(describeError(err, "Could not add the product."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("primary", "md")}>
        Add product
      </button>

      <Modal open={open} title="Add a product" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-3">
          <ProductFields categories={categories} />
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
              {busy ? "Adding…" : "Add product"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function EditProductButton({
  product,
  categories,
}: {
  product: EditableProduct;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = readForm(new FormData(event.currentTarget));
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/menu/products/${product.id}`, { method: "PATCH", body: JSON.stringify(body) });
      push(`"${body.name}" updated.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(describeError(err, "Could not save the changes."));
    } finally {
      setBusy(false);
    }
  }

  async function retire() {
    setBusy(true);
    try {
      await apiFetch(`/api/menu/products/${product.id}`, { method: "DELETE" });
      push(`"${product.name}" retired — past orders keep their history.`);
      setConfirmRetire(false);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(describeError(err, "Could not retire the product."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>
        Edit
      </button>

      <Modal open={open} title={`Edit ${product.name}`} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-3">
          <ProductFields product={product} categories={categories} />
          {error ? (
            <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => setConfirmRetire(true)}
              className={buttonClass("ghost", "sm", "text-danger")}
            >
              Retire
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary", "sm")}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={buttonClass("primary", "sm")}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmRetire}
        title={`Retire ${product.name}?`}
        description="It stops being orderable and disappears from the available menu. Past orders are untouched — they keep their own copy of the name and price."
        confirmLabel="Retire product"
        destructive
        busy={busy}
        onConfirm={retire}
        onCancel={() => setConfirmRetire(false)}
      />
    </>
  );
}

export function AddCategoryButton() {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/menu/categories", {
        method: "POST",
        body: JSON.stringify({ name, sortOrder: Number(form.get("sortOrder") ?? 0), isActive: true }),
      });
      push(`Category "${name}" created.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(describeError(err, "Could not create the category."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "md")}>
        Add category
      </button>

      <Modal open={open} title="Add a category" onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Name" hint="How you group the menu, e.g. Cookies, Brownies, Drinks.">
            <input name="name" required maxLength={120} className={inputClass} autoFocus />
          </Field>
          <Field label="Sort order" hint="Lower numbers appear first.">
            <input name="sortOrder" type="number" min={0} defaultValue={0} className={inputClass} />
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
              {busy ? "Creating…" : "Create category"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
