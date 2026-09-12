import { z } from "zod";

export const createReviewSchema = z
  .object({
    orderId: z.string().uuid().optional(),
    /** n8n usually knows the order number, not the internal id. */
    orderNumber: z.string().trim().max(60).optional(),
    rating: z.coerce.number().int().min(1, "Rating must be 1-5").max(5, "Rating must be 1-5"),
    comment: z.string().trim().max(2000).optional(),
    source: z.string().trim().max(40).default("WHATSAPP"),
    externalEventId: z.string().trim().max(200).optional(),
  })
  .refine((v) => Boolean(v.orderId || v.orderNumber), {
    message: "Either orderId or orderNumber is required",
    path: ["orderId"],
  });

export const listReviewsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  customerId: z.string().uuid().optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type ListReviewsInput = z.infer<typeof listReviewsSchema>;
