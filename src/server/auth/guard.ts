import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/prisma";
import { readSession } from "@/server/auth/session";
import type { TenantContext } from "@/server/core/context";
import { ForbiddenError, UnauthorizedError } from "@/server/core/errors";
import { assertCan, type Permission } from "@/server/auth/permissions";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: TenantContext["role"];
  restaurantId: string;
  restaurantName: string;
  currency: string;
};

/**
 * Server-component guard. Re-reads the user on every request so a deactivated
 * account or a role change takes effect immediately instead of waiting for the
 * JWT to expire.
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await readSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findFirst({
    where: { id: session.userId, restaurantId: session.restaurantId, isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      restaurantId: true,
      restaurant: { select: { name: true, currency: true, isActive: true } },
    },
  });

  if (!user || !user.restaurant.isActive) redirect("/login?error=session_invalid");

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    restaurantId: user.restaurantId,
    restaurantName: user.restaurant.name,
    currency: user.restaurant.currency,
  };
}

export function toContext(user: CurrentUser): TenantContext {
  return {
    restaurantId: user.restaurantId,
    userId: user.id,
    role: user.role,
    actorType: "USER",
    actorLabel: user.name,
  };
}

/** Page-level guard: send users without the permission back to a safe screen. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  try {
    assertCan(toContext(user), permission);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      redirect(user.role === "DELIVERY" ? "/deliveries/mine?error=forbidden" : "/dashboard?error=forbidden");
    }
    throw error;
  }
  return user;
}

/** Route-handler guard for cookie-authenticated calls (the dashboard's own UI). */
export async function requireSessionContext(): Promise<TenantContext> {
  const session = await readSession();
  if (!session) throw new UnauthorizedError();
  const user = await prisma.user.findFirst({
    where: { id: session.userId, restaurantId: session.restaurantId, isActive: true },
    select: { id: true, name: true, role: true, restaurantId: true },
  });
  if (!user) throw new UnauthorizedError("Session is no longer valid");
  return {
    restaurantId: user.restaurantId,
    userId: user.id,
    role: user.role,
    actorType: "USER",
    actorLabel: user.name,
  };
}
