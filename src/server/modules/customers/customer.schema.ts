import { z } from "zod";

export const whatsappNumberSchema = z
  .string()
  .min(6, "WhatsApp number is too short")
  .max(24, "WhatsApp number is too long");

export const createCustomerSchema = z.object({
  whatsappNumber: whatsappNumberSchema,
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(24).optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial().omit({ whatsappNumber: true });

export const listCustomersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  customerType: z.enum(["NEW", "REGULAR", "LOYAL", "VIP", "INACTIVE"]).optional(),
  city: z.string().trim().max(120).optional(),
  sort: z.enum(["recent", "spend", "orders", "name"]).default("recent"),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersInput = z.infer<typeof listCustomersSchema>;
