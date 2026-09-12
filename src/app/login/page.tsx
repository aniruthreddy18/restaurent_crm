import { redirect } from "next/navigation";
import { readSession } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Restaurant CRM" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await readSession();
  if (session) redirect(session.role === "DELIVERY" ? "/deliveries/mine" : "/dashboard");

  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Restaurant CRM</h1>
          <p className="mt-1 text-sm text-ink-muted">Sign in to manage orders and customers</p>
        </div>

        {error === "session_invalid" ? (
          <p className="mb-4 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-ink">
            Your session expired. Please sign in again.
          </p>
        ) : null}

        <LoginForm />
      </div>
    </div>
  );
}
