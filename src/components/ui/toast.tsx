"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/cn";

type ToastLevel = "success" | "error" | "info";
type Toast = { id: string; message: string; level: ToastLevel };

const ToastContext = createContext<{ push: (message: string, level?: ToastLevel) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, level: ToastLevel = "success") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, level }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg",
              toast.level === "success" && "border-ok/30 bg-ok-soft text-ink",
              toast.level === "error" && "border-danger/30 bg-danger-soft text-ink",
              toast.level === "info" && "border-info/30 bg-info-soft text-ink",
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
