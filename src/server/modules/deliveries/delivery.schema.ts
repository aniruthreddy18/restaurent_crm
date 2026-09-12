import { z } from "zod";

export const createDeliverySchema = z.object({
  orderId: z.string().uuid(),
  driverId: z.string().uuid().optional().nullable(),
  deliveryAddress: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const updateDeliverySchema = z.object({
  driverId: z.string().uuid().optional().nullable(),
  status: z.enum(["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED"]).optional(),
  deliveryAddress: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
  failureReason: z.string().trim().max(500).optional(),
});

export const listDeliveriesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED"]).optional(),
  driverId: z.string().uuid().optional(),
  /** "me" restricts to the signed-in driver's own assignments. */
  scope: z.enum(["all", "me"]).default("all"),
});

export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
export type UpdateDeliveryInput = z.infer<typeof updateDeliverySchema>;
export type ListDeliveriesInput = z.infer<typeof listDeliveriesSchema>;
