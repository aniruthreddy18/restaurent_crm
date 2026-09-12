import Link from "next/link";
import { cn } from "@/lib/cn";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("card", className)}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "ok" | "warn" | "danger" | "brand";
}) {
  return (
    <div className="card px-4 py-3.5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "danger" && "text-danger",
          tone === "brand" && "text-brand-strong",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="max-w-sm text-sm text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="card border-danger/30 bg-danger-soft px-5 py-4">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55";

const buttonVariants = {
  primary: "border-transparent bg-brand text-white hover:bg-brand-strong",
  secondary: "border-line bg-surface text-ink hover:bg-surface-muted",
  ghost: "border-transparent bg-transparent text-ink-muted hover:bg-surface-muted hover:text-ink",
  danger: "border-transparent bg-danger text-white hover:opacity-90",
} as const;

const buttonSizes = {
  sm: "h-8 px-3",
  md: "h-9.5 px-4",
  lg: "h-12 px-6 text-base",
} as const;

export function buttonClass(
  variant: keyof typeof buttonVariants = "primary",
  size: keyof typeof buttonSizes = "md",
  className?: string,
) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-subtle">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none";

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn("whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle", className)}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 text-sm text-ink", className)}>{children}</td>;
}
