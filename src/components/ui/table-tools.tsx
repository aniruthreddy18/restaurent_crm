"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { buttonClass, inputClass } from "@/components/ui/primitives";

/** Pushes a query param into the URL so filters survive refresh and sharing. */
function useQueryUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    // Any filter change resets paging — page 3 of a new filter is meaningless.
    if (!("page" in updates)) next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  };
}

export function SearchInput({ placeholder = "Search…" }: { placeholder?: string }) {
  const params = useSearchParams();
  const update = useQueryUpdater();
  const searchParam = params.get("search") ?? "";
  const [value, setValue] = useState(searchParam);
  const [syncedParam, setSyncedParam] = useState(searchParam);
  const [, startTransition] = useTransition();

  // Re-sync the box when the URL changes from outside (back button, a filter
  // reset). Adjusting state during render is React's recommended pattern here
  // — an effect would cause a second render pass for no benefit.
  if (searchParam !== syncedParam) {
    setSyncedParam(searchParam);
    setValue(searchParam);
  }

  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => update({ search: value || undefined }));
      }}
    >
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(inputClass, "sm:w-64")}
      />
      <button type="submit" className={buttonClass("secondary", "md")}>
        Search
      </button>
    </form>
  );
}

export function FilterSelect({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
}) {
  const params = useSearchParams();
  const update = useQueryUpdater();

  return (
    <label className="flex items-center gap-2 text-xs text-ink-muted">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={params.get(name) ?? ""}
        onChange={(e) => update({ [name]: e.target.value || undefined })}
        className={cn(inputClass, "h-9.5 w-auto py-0")}
        aria-label={label}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const update = useQueryUpdater();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
      <p className="text-xs text-ink-muted">
        Showing <span className="font-medium text-ink">{first}</span>–
        <span className="font-medium text-ink">{last}</span> of{" "}
        <span className="font-medium text-ink">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={buttonClass("secondary", "sm")}
          disabled={page <= 1}
          onClick={() => update({ page: String(page - 1) })}
        >
          Previous
        </button>
        <span className="text-xs text-ink-muted">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          className={buttonClass("secondary", "sm")}
          disabled={page >= totalPages}
          onClick={() => update({ page: String(page + 1) })}
        >
          Next
        </button>
      </div>
    </div>
  );
}
