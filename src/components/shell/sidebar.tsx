"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { UserRole } from "@prisma/client";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

export type NavVisibility = Record<string, boolean>;

const NAV = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard", icon: "▦" },
  { key: "customers", href: "/customers", label: "Customers", icon: "☺" },
  { key: "orders", href: "/orders", label: "Orders", icon: "☰" },
  { key: "menu", href: "/menu", label: "Menu", icon: "🍽" },
  { key: "payments", href: "/payments", label: "Payments", icon: "₹" },
  { key: "deliveries", href: "/deliveries", label: "Deliveries", icon: "➤" },
  { key: "reviews", href: "/reviews", label: "Reviews", icon: "★" },
  { key: "conversations", href: "/conversations", label: "Conversations", icon: "💬" },
  { key: "analytics", href: "/analytics", label: "Analytics", icon: "📈" },
  { key: "staff", href: "/staff", label: "Staff", icon: "👥" },
  { key: "settings", href: "/settings", label: "Settings", icon: "⚙" },
] as const;

export function Sidebar({
  visible,
  user,
}: {
  visible: NavVisibility;
  user: { name: string; role: UserRole; restaurantName: string };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);

  // Delivery staff get their own scoped screen rather than the full list.
  const items = NAV.filter((item) => visible[item.key]).map((item) =>
    item.key === "deliveries" && user.role === "DELIVERY"
      ? { ...item, href: "/deliveries/mine", label: "My deliveries" }
      : item,
  );

  async function logout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      push("Could not sign out. Please try again.", "error");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed left-3 top-3 z-40 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-sm lg:hidden"
        aria-expanded={open}
        aria-controls="sidebar-nav"
      >
        ☰ Menu
      </button>

      {open ? (
        <div className="fixed inset-0 z-30 bg-ink/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden />
      ) : null}

      <aside
        id="sidebar-nav"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-surface transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="border-b border-line px-5 py-4">
          <p className="truncate text-sm font-semibold text-ink">{user.restaurantName}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">Restaurant CRM</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3" aria-label="Main">
          <ul className="space-y-0.5">
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-brand-soft font-medium text-brand-strong"
                        : "text-ink-muted hover:bg-surface-muted hover:text-ink",
                    )}
                  >
                    <span className="w-4 text-center text-xs" aria-hidden>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-line px-4 py-3">
          <p className="truncate text-sm font-medium text-ink">{user.name}</p>
          <p className="text-xs text-ink-subtle">{user.role.toLowerCase()}</p>
          <button
            type="button"
            onClick={logout}
            className="mt-2 text-xs font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
