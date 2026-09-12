import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { TenantContext } from "@/server/core/context";
import { NotFoundError } from "@/server/core/errors";
import { assertCan } from "@/server/auth/permissions";
import { money } from "@/lib/money";
import { paginated } from "@/server/core/pagination";
import { recordAudit } from "@/server/audit/audit";
import type {
  CreateCategoryInput,
  CreateProductInput,
  ListProductsInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from "./menu.schema";

/**
 * The CRM can hold the full menu, but today the customer-facing menu is still
 * served from Google Sheets via n8n. Nothing here assumes Sheets exists:
 * `externalRef` is the only hook, it is nullable, and removing the Sheets
 * integration later requires no schema change.
 */

export async function listCategories(ctx: TenantContext) {
  assertCan(ctx, "menu:read");
  return prisma.category.findMany({
    where: { restaurantId: ctx.restaurantId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } },
  });
}

export async function createCategory(ctx: TenantContext, input: CreateCategoryInput) {
  assertCan(ctx, "menu:write");
  return prisma.$transaction(async (tx) => {
    const category = await tx.category.create({
      data: {
        restaurantId: ctx.restaurantId,
        name: input.name,
        description: input.description ?? null,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      },
    });
    await recordAudit(tx, ctx, {
      action: "category.created",
      entityType: "category",
      entityId: category.id,
      newValue: { name: category.name },
    });
    return category;
  });
}

export async function updateCategory(ctx: TenantContext, categoryId: string, input: UpdateCategoryInput) {
  assertCan(ctx, "menu:write");
  const existing = await prisma.category.findFirst({ where: { id: categoryId, restaurantId: ctx.restaurantId } });
  if (!existing) throw new NotFoundError("Category");

  return prisma.$transaction(async (tx) => {
    const category = await tx.category.update({
      where: { id: existing.id },
      data: {
        name: input.name ?? undefined,
        description: input.description ?? undefined,
        sortOrder: input.sortOrder ?? undefined,
        isActive: input.isActive ?? undefined,
      },
    });
    await recordAudit(tx, ctx, {
      action: "category.updated",
      entityType: "category",
      entityId: category.id,
      oldValue: { name: existing.name, isActive: existing.isActive },
      newValue: { name: category.name, isActive: category.isActive },
    });
    return category;
  });
}

export async function listProducts(ctx: TenantContext, input: ListProductsInput) {
  assertCan(ctx, "menu:read");

  const where: Prisma.ProductWhereInput = { restaurantId: ctx.restaurantId };
  if (input.categoryId) where.categoryId = input.categoryId;
  if (input.available) where.isAvailable = input.available === "true";
  if (input.search) {
    where.OR = [
      { name: { contains: input.search, mode: "insensitive" } },
      { sku: { contains: input.search, mode: "insensitive" } },
      { description: { contains: input.search, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ isAvailable: "desc" }, { name: "asc" }],
      include: { category: { select: { id: true, name: true } } },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return paginated(rows, total, { page: input.page, pageSize: input.pageSize });
}

export async function getProduct(ctx: TenantContext, productId: string) {
  assertCan(ctx, "menu:read");
  const product = await prisma.product.findFirst({
    where: { id: productId, restaurantId: ctx.restaurantId },
    include: { category: true },
  });
  if (!product) throw new NotFoundError("Product");
  return product;
}

export async function createProduct(ctx: TenantContext, input: CreateProductInput) {
  assertCan(ctx, "menu:write");
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        restaurantId: ctx.restaurantId,
        categoryId: input.categoryId ?? null,
        name: input.name,
        description: input.description ?? null,
        price: money(input.price),
        imageUrl: input.imageUrl || null,
        sku: input.sku || null,
        preparationTime: input.preparationTime ?? null,
        isAvailable: input.isAvailable,
        externalRef: input.externalRef ?? null,
      },
    });
    await recordAudit(tx, ctx, {
      action: "product.created",
      entityType: "product",
      entityId: product.id,
      newValue: { name: product.name, price: product.price.toString() },
    });
    return product;
  });
}

export async function updateProduct(ctx: TenantContext, productId: string, input: UpdateProductInput) {
  // Kitchen staff may flip availability but not edit prices; anything beyond
  // the availability flag needs full menu-write rights.
  const onlyAvailability = Object.keys(input).length === 1 && "isAvailable" in input;
  assertCan(ctx, onlyAvailability ? "menu:availability" : "menu:write");

  const existing = await prisma.product.findFirst({ where: { id: productId, restaurantId: ctx.restaurantId } });
  if (!existing) throw new NotFoundError("Product");

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.update({
      where: { id: existing.id },
      data: {
        categoryId: input.categoryId === undefined ? undefined : input.categoryId,
        name: input.name ?? undefined,
        description: input.description ?? undefined,
        price: input.price === undefined ? undefined : money(input.price),
        imageUrl: input.imageUrl === "" ? null : (input.imageUrl ?? undefined),
        sku: input.sku ?? undefined,
        preparationTime: input.preparationTime ?? undefined,
        isAvailable: input.isAvailable ?? undefined,
        externalRef: input.externalRef ?? undefined,
      },
    });

    await recordAudit(tx, ctx, {
      action: onlyAvailability ? "product.availability_changed" : "product.updated",
      entityType: "product",
      entityId: product.id,
      oldValue: { name: existing.name, price: existing.price.toString(), isAvailable: existing.isAvailable },
      newValue: { name: product.name, price: product.price.toString(), isAvailable: product.isAvailable },
    });

    return product;
  });
}

export async function deleteProduct(ctx: TenantContext, productId: string) {
  assertCan(ctx, "menu:write");
  const existing = await prisma.product.findFirst({ where: { id: productId, restaurantId: ctx.restaurantId } });
  if (!existing) throw new NotFoundError("Product");

  // Soft delete: order_items keep a nullable FK to products, and hard-deleting
  // would sever the (informational) link on historical orders.
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.update({ where: { id: existing.id }, data: { isAvailable: false } });
    await recordAudit(tx, ctx, {
      action: "product.retired",
      entityType: "product",
      entityId: product.id,
      oldValue: { isAvailable: existing.isAvailable },
      newValue: { isAvailable: false },
    });
    return product;
  });
}
