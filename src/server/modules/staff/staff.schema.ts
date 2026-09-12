import { z } from "zod";

export const createStaffSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  role: z.enum(["ADMIN", "MANAGER", "KITCHEN", "CASHIER", "DELIVERY"]),
  phone: z.string().trim().max(24).optional(),
  /** Vehicle detail, only meaningful for the DELIVERY role. */
  vehicle: z.string().trim().max(60).optional(),
});

export const updateStaffSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["ADMIN", "MANAGER", "KITCHEN", "CASHIER", "DELIVERY"]).optional(),
  phone: z.string().trim().max(24).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
