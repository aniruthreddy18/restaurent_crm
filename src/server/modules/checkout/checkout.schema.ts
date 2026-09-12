import { z } from "zod";

export const checkoutItemSchema = z.object({
  productId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(200),
  price: z.coerce.number().nonnegative(),
  quantity: z.coerce.number().int().min(1).max(999),
  notes: z.string().trim().max(300).optional(),
});

export const upsertCheckoutSchema = z.object({
  sessionId: z.string().trim().min(3).max(120),
  whatsappNumber: z.string().trim().min(6).max(24),
  customerName: z.string().trim().max(120).optional(),
  items: z.array(checkoutItemSchema).default([]),
  deliveryAddress: z.string().trim().max(500).optional(),
  deliveryFee: z.coerce.number().nonnegative().default(0),
  discount: z.coerce.number().nonnegative().default(0),
  tax: z.coerce.number().nonnegative().default(0),
  /** Minutes until the cart is considered abandoned. */
  expiresInMinutes: z.coerce.number().int().min(1).max(1440).default(60),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const listCheckoutSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["ACTIVE", "CONVERTED", "ABANDONED", "EXPIRED"]).optional(),
  whatsappNumber: z.string().trim().max(24).optional(),
});

export type CheckoutItemInput = z.infer<typeof checkoutItemSchema>;
export type UpsertCheckoutInput = z.infer<typeof upsertCheckoutSchema>;
export type ListCheckoutInput = z.infer<typeof listCheckoutSchema>;
