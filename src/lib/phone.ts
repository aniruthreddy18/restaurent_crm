/**
 * WhatsApp numbers are the identity key for customers, so normalisation has to
 * be deterministic: the same human must always collapse to the same string.
 *
 * Output is E.164 without the leading "+" (matching the WhatsApp Cloud API's
 * `wa_id` format), e.g. "919876543210".
 */
export function normalizeWhatsAppNumber(raw: string, defaultCountryCode = "91"): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) throw new Error("WhatsApp number is required");

  // Keep digits only; "+", spaces, dashes, brackets and "whatsapp:" prefixes go.
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) throw new Error(`Cannot normalise WhatsApp number: "${raw}"`);

  // Strip international dialling prefixes: 00<cc> and a single trunk 0.
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.length > 10 && digits.startsWith("0")) digits = digits.replace(/^0+/, "");

  // A bare national number (<= 10 digits) gets the default country code.
  if (digits.length <= 10) digits = `${defaultCountryCode}${digits.replace(/^0+/, "")}`;

  if (digits.length < 8 || digits.length > 15) {
    throw new Error(`WhatsApp number "${raw}" is not a valid E.164 number`);
  }
  return digits;
}

/** Best-effort display form: "+91 98765 43210". Never used for lookups. */
export function formatWhatsAppNumber(normalized: string): string {
  if (normalized.length === 12 && normalized.startsWith("91")) {
    return `+91 ${normalized.slice(2, 7)} ${normalized.slice(7)}`;
  }
  return `+${normalized}`;
}
