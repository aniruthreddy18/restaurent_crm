"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { buttonClass, Field, inputClass } from "@/components/ui/primitives";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ user: { role: string } }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push(result.user.role === "DELIVERY" ? "/deliveries/mine" : "/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5">
      <Field label="Email">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="username"
          autoFocus
          className={inputClass}
        />
      </Field>

      <Field label="Password">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </Field>

      {error ? (
        <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-ink" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={busy} className={buttonClass("primary", "md", "w-full")}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
