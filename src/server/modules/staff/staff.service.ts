import { prisma } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { BusinessRuleError, NotFoundError } from "@/server/core/errors";
import { assertCan } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";
import { recordAudit } from "@/server/audit/audit";
import type { CreateStaffInput, UpdateStaffInput } from "./staff.schema";

export async function listStaff(ctx: TenantContext) {
  assertCan(ctx, "staff:read");
  return prisma.user.findMany({
    where: { restaurantId: ctx.restaurantId },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      driver: { select: { id: true, vehicle: true } },
    },
  });
}

/** A DELIVERY user automatically gets a driver profile so they can be assigned. */
export async function createStaff(ctx: TenantContext, input: CreateStaffInput) {
  assertCan(ctx, "staff:write");
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        restaurantId: ctx.restaurantId,
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash,
        role: input.role,
        phone: input.phone ?? null,
      },
    });

    if (input.role === "DELIVERY") {
      await tx.deliveryDriver.create({
        data: {
          restaurantId: ctx.restaurantId,
          userId: user.id,
          name: input.name,
          phone: input.phone ?? "",
          vehicle: input.vehicle ?? null,
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: "staff.created",
      entityType: "user",
      entityId: user.id,
      newValue: { email: user.email, role: user.role },
    });

    return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
  });
}

export async function updateStaff(ctx: TenantContext, userId: string, input: UpdateStaffInput) {
  assertCan(ctx, "staff:write");

  const existing = await prisma.user.findFirst({ where: { id: userId, restaurantId: ctx.restaurantId } });
  if (!existing) throw new NotFoundError("Staff member");

  // Guard against locking the restaurant out of its own CRM.
  if ((input.isActive === false || (input.role && input.role !== "ADMIN")) && existing.role === "ADMIN") {
    const otherAdmins = await prisma.user.count({
      where: { restaurantId: ctx.restaurantId, role: "ADMIN", isActive: true, id: { not: existing.id } },
    });
    if (otherAdmins === 0) {
      throw new BusinessRuleError("The last active admin cannot be demoted or deactivated", "LAST_ADMIN");
    }
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: existing.id },
      data: {
        name: input.name ?? undefined,
        role: input.role ?? undefined,
        phone: input.phone ?? undefined,
        isActive: input.isActive ?? undefined,
        passwordHash: input.password ? await hashPassword(input.password) : undefined,
      },
    });

    // Keep the driver profile in step with the role.
    if (input.role === "DELIVERY") {
      await tx.deliveryDriver.upsert({
        where: { userId: user.id },
        create: {
          restaurantId: ctx.restaurantId,
          userId: user.id,
          name: user.name,
          phone: user.phone ?? "",
        },
        update: { name: user.name, isActive: user.isActive },
      });
    } else if (input.role) {
      await tx.deliveryDriver.updateMany({ where: { userId: user.id }, data: { isActive: false } });
    }

    await recordAudit(tx, ctx, {
      action: "staff.updated",
      entityType: "user",
      entityId: user.id,
      oldValue: { role: existing.role, isActive: existing.isActive },
      newValue: { role: user.role, isActive: user.isActive, passwordChanged: Boolean(input.password) },
    });

    return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
  });
}
