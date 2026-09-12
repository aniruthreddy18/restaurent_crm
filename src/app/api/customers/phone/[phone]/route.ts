import { withApi } from "@/server/http/handler";
import { ok } from "@/server/http/responses";
import { NotFoundError } from "@/server/core/errors";
import { findCustomerByPhone } from "@/server/modules/customers/customer.service";

/**
 * GET /api/customers/phone/:phone
 *
 * Find a customer by phone or WhatsApp number, in any format — URL-encode a
 * leading "+" as %2B, or just send the digits.
 *
 * Returns 404 when the number has no CRM customer yet, which is the normal,
 * expected answer for anyone who has not completed a payment. Treat it as
 * "not a customer yet", not as an error.
 */
export const GET = withApi({ permission: "customers:read" }, async ({ ctx, params }) => {
  const { customer, whatsappNumber } = await findCustomerByPhone(ctx, decodeURIComponent(params.phone));

  if (!customer) {
    // Include the normalised form so the caller can reuse it verbatim.
    throw new NotFoundError(`Customer for ${whatsappNumber}`);
  }

  return ok({ ...customer, found: true });
});
