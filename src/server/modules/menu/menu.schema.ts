import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = createCategorySchema.partial();

export const createProductSchema = z.object({
  categoryId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  price: z.coerce.number().nonnegative().max(1_000_000),
  imageUrl: z.string().url().optional().or(z.literal("")),
  sku: z.string().trim().max(60).optional(),
  preparationTime: z.coerce.number().int().min(0).max(600).optional(),
  isAvailable: z.boolean().default(true),
  externalRef: z.string().trim().max(200).optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const listProductsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().uuid().optional(),
  available: z.enum(["true", "false"]).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsInput = z.infer<typeof listProductsSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
