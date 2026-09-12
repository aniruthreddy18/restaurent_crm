import { z } from "zod";

export const createMessageSchema = z.object({
  whatsappNumber: z.string().trim().min(6).max(24),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  message: z.string().trim().min(1).max(8000),
  externalMessageId: z.string().trim().max(200).optional(),
  status: z.enum(["QUEUED", "SENT", "DELIVERED", "READ", "FAILED"]).default("SENT"),
  orderId: z.string().uuid().optional(),
});

export const listConversationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["OPEN", "CLOSED", "EXPIRED"]).optional(),
  search: z.string().trim().max(120).optional(),
  /** "customers" = only threads that became CRM customers. */
  filter: z.enum(["all", "customers", "prospects"]).default("all"),
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type ListConversationsInput = z.infer<typeof listConversationsSchema>;
