import "server-only";
import { z } from "zod";
import { ConfigurationError } from "@/server/core/errors";

/**
 * Server-side environment. Parsed once, lazily, so that importing a module in a
 * test or a script does not require every production variable to be present.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  COOKIE_SECURE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  AUTH_PROVIDER: z.enum(["local", "supabase"]).default("local"),
  SUPABASE_JWT_SECRET: z.string().optional(),
  N8N_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  N8N_WEBHOOK_SECRET: z.string().optional(),
  EVENT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  EVENT_DISPATCH_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  DEFAULT_COUNTRY_CODE: z.string().default("91"),
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
