import { RateLimitError } from "@/server/core/errors";
import { env } from "@/lib/env";

type Bucket = { count: number; resetAt: number };

/**
 * In-process sliding window. Adequate for a single-instance deployment; swap
 * the Map for Redis (same interface) when the CRM runs more than one replica.
 */
const buckets = new Map<string, Bucket>();

function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

export function consumeRateLimit(key: string, max?: number, windowSeconds?: number) {
  const cfg = env();
  const limit = max ?? cfg.RATE_LIMIT_MAX_REQUESTS;
  const windowMs = (windowSeconds ?? cfg.RATE_LIMIT_WINDOW_SECONDS) * 1000;
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { remaining: limit - 1, resetAt: now + windowMs };
  }

  existing.count += 1;
  if (existing.count > limit) {
    throw new RateLimitError(Math.max(1, Math.ceil((existing.resetAt - now) / 1000)));
  }
  return { remaining: limit - existing.count, resetAt: existing.resetAt };
}

/** Test helper. */
export function resetRateLimits() {
  buckets.clear();
}
