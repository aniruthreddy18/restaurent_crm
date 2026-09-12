/**
 * Misconfiguration must be self-diagnosing.
 *
 * Regression: a missing AUTH_SECRET made every authenticated route return an
 * opaque 500 while /api/health still said "ok", which is impossible to debug
 * from outside. Config errors now name the offending variables.
 */
import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "@/lib/env";
import { ConfigurationError } from "@/server/core/errors";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
  resetEnvCache();
});

function envWith(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
  return () => env();
}

describe("configuration errors", () => {
  it("parses a valid environment", () => {
    expect(envWith({})()).toMatchObject({ AUTH_PROVIDER: "local" });
  });

  it("names AUTH_SECRET when it is missing", () => {
    const read = envWith({ AUTH_SECRET: undefined });
    expect(read).toThrow(ConfigurationError);

    try {
      read();
    } catch (error) {
      const configError = error as ConfigurationError;
      expect(configError.status).toBe(503);
      expect(configError.code).toBe("CONFIGURATION_ERROR");
      expect(configError.message).toContain("AUTH_SECRET");
      expect(configError.message).toContain("redeploy");
    }
  });

  it("names AUTH_SECRET when it is too short to be safe", () => {
    const read = envWith({ AUTH_SECRET: "short" });
    expect(read).toThrow(/AUTH_SECRET/);
  });

  it("catches a malformed webhook URL", () => {
    expect(envWith({ N8N_WEBHOOK_URL: "not a url" })).toThrow(/N8N_WEBHOOK_URL/);
    // An empty string is explicitly allowed — it means "no webhook configured".
    expect(envWith({ N8N_WEBHOOK_URL: "" })).not.toThrow();
  });

  it("reports every broken variable at once, not one per redeploy", () => {
    const read = envWith({ AUTH_SECRET: "short", N8N_WEBHOOK_URL: "nope" });
    try {
      read();
      throw new Error("expected a ConfigurationError");
    } catch (error) {
      const details = (error as ConfigurationError).details as { variable: string }[];
      const named = details.map((d) => d.variable);
      expect(named).toContain("AUTH_SECRET");
      expect(named).toContain("N8N_WEBHOOK_URL");
    }
  });

  it("treats an empty variable as unset and applies the default", () => {
    // Regression: hosting dashboards store "not set" as "". Zod defaults only
    // fire on undefined, so empty boxes used to coerce to 0 and fail — taking
    // down every authenticated route on a first deployment.
    const read = envWith({
      SESSION_TTL_HOURS: "",
      AUTH_PROVIDER: "",
      EVENT_MAX_ATTEMPTS: "",
      EVENT_DISPATCH_BATCH_SIZE: "",
      RATE_LIMIT_WINDOW_SECONDS: "",
      RATE_LIMIT_MAX_REQUESTS: "",
      COOKIE_SECURE: "",
      DEFAULT_COUNTRY_CODE: "",
      N8N_WEBHOOK_URL: "",
      N8N_WEBHOOK_SECRET: "",
    });

    expect(read).not.toThrow();
    expect(read()).toMatchObject({
      SESSION_TTL_HOURS: 12,
      AUTH_PROVIDER: "local",
      EVENT_MAX_ATTEMPTS: 8,
      EVENT_DISPATCH_BATCH_SIZE: 25,
      RATE_LIMIT_WINDOW_SECONDS: 60,
      RATE_LIMIT_MAX_REQUESTS: 120,
      COOKIE_SECURE: false,
      DEFAULT_COUNTRY_CODE: "91",
    });
  });

  it("still rejects the two variables that have no safe default", () => {
    expect(envWith({ AUTH_SECRET: "" })).toThrow(/AUTH_SECRET/);
    expect(envWith({ DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("still honours explicitly set values", () => {
    expect(envWith({ SESSION_TTL_HOURS: "4", COOKIE_SECURE: "true" })()).toMatchObject({
      SESSION_TTL_HOURS: 4,
      COOKIE_SECURE: true,
    });
  });

  it("never puts a secret value in the message", () => {
    const secret = "this-is-a-real-secret-value-nobody-should-see";
    const read = envWith({ AUTH_SECRET: secret, N8N_WEBHOOK_URL: "nope" });
    try {
      read();
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
      expect(JSON.stringify((error as ConfigurationError).details)).not.toContain(secret);
    }
  });
});
