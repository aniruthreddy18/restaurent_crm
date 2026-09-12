import { createHmac, timingSafeEqual } from "crypto";

/**
 * Webhook signing: `sha256=<hex HMAC of "<timestamp>.<body>">`.
 * The timestamp is inside the signed material so a captured delivery cannot be
 * replayed later against the receiver.
 */
export function signPayload(secret: string, body: string, timestamp: number) {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${mac}`;
}

export function verifySignature(
  secret: string,
  body: string,
  timestamp: number,
  signature: string,
  toleranceSeconds = 300,
) {
  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;
  const expected = Buffer.from(signPayload(secret, body, timestamp));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
