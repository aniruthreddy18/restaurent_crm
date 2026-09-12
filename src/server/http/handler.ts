import { NextRequest, after } from "next/server";
import { z } from "zod";
import type { TenantContext } from "@/server/core/context";
import { assertCan, type Permission } from "@/server/auth/permissions";
import { authenticateApiKey, extractApiKey } from "@/server/auth/api-key";
import { requireSessionContext } from "@/server/auth/guard";
import { CSRF_COOKIE } from "@/server/auth/session";
import { consumeRateLimit } from "@/server/http/rate-limit";
import { fail, toAppError } from "@/server/http/responses";
import { ForbiddenError, UnauthorizedError, ValidationError } from "@/server/core/errors";

type Auth = "api-key" | "session" | "any";

/**
 * Generic over the SCHEMAS rather than over their types, so `body` and `query`
 * are the schema's *output* (post-defaults, post-coercion) rather than its
 * input — otherwise every `.default()` field would read as possibly undefined.
 */
type HandlerArgs<TBodySchema extends z.ZodTypeAny, TQuerySchema extends z.ZodTypeAny> = {
  req: NextRequest;
  ctx: TenantContext;
  body: z.output<TBodySchema>;
  query: z.output<TQuerySchema>;
  params: Record<string, string>;
};

type Options<TBodySchema extends z.ZodTypeAny, TQuerySchema extends z.ZodTypeAny> = {
  /** Which credentials the endpoint accepts. "any" allows n8n *or* the UI. */
  auth?: Auth;
  permission?: Permission;
  bodySchema?: TBodySchema;
  querySchema?: TQuerySchema;
  /** Per-endpoint override of the global rate limit. */
  rateLimit?: { max: number; windowSeconds?: number };
};

function clientIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function authenticate(req: NextRequest, mode: Auth): Promise<TenantContext> {
  const ip = clientIp(req);
  const rawKey = extractApiKey(req.headers);

  if (mode === "api-key") {
    if (!rawKey) throw new UnauthorizedError("Missing API key");
    return authenticateApiKey(rawKey, ip);
  }

  if (mode === "session") return { ...(await requireSessionContext()), ipAddress: ip };

  // "any": prefer an explicit API key, fall back to the dashboard session.
  if (rawKey) return authenticateApiKey(rawKey, ip);
  return { ...(await requireSessionContext()), ipAddress: ip };
}

/**
 * CSRF defence for cookie-authenticated mutations: the request must echo the
 * non-httpOnly CSRF cookie in a header. A cross-site page can make the browser
 * send cookies but cannot read one to set the header.
 * API-key callers are exempt — they do not rely on ambient cookie authority.
 */
function assertCsrf(req: NextRequest, ctx: TenantContext) {
  if (ctx.actorType !== "USER") return;
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const cookieToken = req.cookies.get(CSRF_COOKIE)?.value;
  const headerToken = req.headers.get("x-csrf-token");
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw new ForbiddenError("Invalid or missing CSRF token");
  }
}

async function parseBody(req: NextRequest) {
  if (["GET", "HEAD", "DELETE"].includes(req.method)) return {};
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}

/**
 * Wraps a route handler with authentication, authorisation, CSRF, rate
 * limiting, schema validation and error mapping, so individual routes only
 * contain business intent.
 */
export function withApi<
  TBodySchema extends z.ZodTypeAny = z.ZodTypeAny,
  TQuerySchema extends z.ZodTypeAny = z.ZodTypeAny,
>(
  options: Options<TBodySchema, TQuerySchema>,
  handler: (args: HandlerArgs<TBodySchema, TQuerySchema>) => Promise<Response>,
) {
  return async (req: NextRequest, routeCtx?: { params?: Promise<Record<string, string>> }) => {
    try {
      const ctx = await authenticate(req, options.auth ?? "any");
      assertCsrf(req, ctx);

      const limiterKey = `${ctx.actorType}:${ctx.actorLabel ?? ctx.userId ?? clientIp(req)}:${ctx.restaurantId}`;
      consumeRateLimit(limiterKey, options.rateLimit?.max, options.rateLimit?.windowSeconds);

      if (options.permission) assertCan(ctx, options.permission);

      const rawBody = await parseBody(req);
      const body: z.output<TBodySchema> = options.bodySchema ? options.bodySchema.parse(rawBody) : rawBody;

      const rawQuery = Object.fromEntries(req.nextUrl.searchParams.entries());
      const query: z.output<TQuerySchema> = options.querySchema ? options.querySchema.parse(rawQuery) : rawQuery;

      const params = routeCtx?.params ? await routeCtx.params : {};

      const response = await handler({ req, ctx, body, query, params });

      // A mutation may have just written to the event outbox. Flush it AFTER
      // the response is sent, so webhook latency never lands on the caller and
      // a slow n8n cannot make the CRM look slow.
      //
      // This is what replaces a long-running dispatcher on serverless hosts.
      // It is best-effort by design: the outbox is the source of truth, and
      // anything missed here is picked up by the next flush or by n8n polling
      // GET /api/events.
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && response.ok) {
        after(async () => {
          try {
            const { dispatchPendingEvents } = await import("@/server/events/dispatcher");
            await dispatchPendingEvents();
          } catch (error) {
            console.error("[events] post-response dispatch failed:", error);
          }
        });
      }

      return response;
    } catch (error) {
      return fail(toAppError(error));
    }
  };
}
