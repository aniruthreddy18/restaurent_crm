import Link from "next/link";
import { buttonClass } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card max-w-md p-6 text-center">
        <h1 className="text-base font-semibold text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-ink-muted">
          This page does not exist, or it belongs to a different restaurant.
        </p>
        <Link href="/dashboard" className={buttonClass("primary", "md", "mt-5")}>
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
