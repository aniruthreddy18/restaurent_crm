"use client";

import { useEffect } from "react";
import { buttonClass } from "@/components/ui/primitives";

/**
 * Dashboard error boundary. Staff are not technical, so it says what to do
 * rather than what broke; the detail goes to the server log.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);

  return (
    <div className="card mx-auto mt-10 max-w-lg p-6 text-center">
      <h1 className="text-base font-semibold text-ink">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-muted">
        This screen could not be loaded. Your orders and customer data are safe — nothing was changed.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-xs text-ink-subtle">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" onClick={reset} className={buttonClass("primary", "md")}>
          Try again
        </button>
        <a href="/dashboard" className={buttonClass("secondary", "md")}>
          Back to dashboard
        </a>
      </div>
    </div>
  );
}
