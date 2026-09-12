import "server-only";
import { z } from "zod";
import { ConfigurationError } from "@/server/core/errors";

/**
 * Server-side environment. Parsed once, lazily, so that importing a module in a
 * test or a script does not require every production variable to be present.
 */
/**
 * Hosting dashboards (Vercel, Railway, Render) store "not set" as an EMPTY
 * STRING rather than omitting the variable. Zod's `.default()` only fires on
 * `undefined`, so without this an empty box coerces to 0 / "" and fails
 * validation — which is exactly how a first deployment ends up with every
 * authenticated route returning 500.
 */
const unsetAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

const schema = z.object({
  // Genuinely required — there is no safe default for either.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),

  // Everything below has a working default; an empty value means "use it".
  SESSION_TTL_HOURS: unsetAsUndefined(z.coerce.number().int().positive().default(12)),
  COOKIE_SECURE: unsetAsUndefined(
    z.string().default("false").transform((v) => v === "true"),
  ),
  AUTH_PROVIDER: unsetAsUndefined(z.enum(["local", "supabase"]).default("local")),
  SUPABASE_JWT_SECRET: unsetAsUndefined(z.string().optional()),
  N8N_WEBHOOK_URL: unsetAsUndefined(z.string().url("must be a full URL, e.g. https://...").optional()),
  N8N_WEBHOOK_SECRET: unsetAsUndefined(z.string().optional()),
  EVENT_MAX_ATTEMPTS: unsetAsUndefined(z.coerce.number().int().positive().default(8)),
  EVENT_DISPATCH_BATCH_SIZE: unsetAsUndefined(z.coerce.number().int().positive().default(25)),
  RATE_LIMIT_WINDOW_SECONDS: unsetAsUndefined(z.coerce.number().int().positive().default(60)),
  RATE_LIMIT_MAX_REQUESTS: unsetAsUndefined(z.coerce.number().int().positive().default(120)),
  DEFAULT_COUNTRY_CODE: unsetAsUndefined(z.string().default("91")),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Names and reasons only — never the values, which are secrets.
    const issues = parsed.error.issues.map((i) => ({
      variable: i.path.join(".") || "(unknown)",
      problem: i.message,
    }));
    const summary = issues.map((i) => `${i.variable} (${i.problem})`).join(", ");
    throw new ConfigurationError(
      `Server is misconfigured. Fix these environment variables and redeploy: ${summary}`,
      issues,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forces the next env() call to re-read process.env. */
export function resetEnvCache() {
  cached = null;
}
