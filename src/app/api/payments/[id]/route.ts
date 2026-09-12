import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { updatePaymentSchema } from "@/server/modules/payments/payment.schema";
import { getPayment, updatePayment } from "@/server/modules/payments/payment.service";

export const GET = withApi({ permission: "payments:read" }, async ({ ctx, params }) =>
  ok(await getPayment(ctx, params.id)),
);

/** Manual correction / refund marking. Does not re-run customer creation. */
export const PATCH = withApi(
  { permission: "payments:write", bodySchema: updatePaymentSchema },
  async ({ ctx, body, params }) => ok(await updatePayment(ctx, params.id, body)),
);
