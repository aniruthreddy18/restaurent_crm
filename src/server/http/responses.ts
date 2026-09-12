import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError, ConflictError, ValidationError } from "@/server/core/errors";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, { status: 200, ...init });
}

export function created<T>(data: T) {
  return NextResponse.json({ success: true, data }, { status: 201 });
}

export function fail(error: AppError) {
  const body = {
    success: false as const,
    error: { code: error.code, message: error.message, details: error.details ?? undefined },
  };
  const headers: Record<string, string> = {};
  if (error.code === "RATE_LIMITED") {
    const details = error.details as { retryAfterSeconds?: number } | undefined;
    headers["Retry-After"] = String(details?.retryAfterSeconds ?? 60);
  }
  return NextResponse.json(body, { status: error.status, headers });
}

/** Maps anything thrown inside a handler onto a stable API error shape. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    return new ValidationError(
      "Request validation failed",
      error.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })),
    );
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = (error.meta?.target as string[] | undefined)?.join(", ") ?? "field";
      return new ConflictError(`A record with this ${target} already exists`);
    }
    if (error.code === "P2025") return new AppError("Resource not found", 404, "NOT_FOUND");
    if (error.code === "P2003") return new ConflictError("Referenced record does not exist");
  }

  const message = error instanceof Error ? error.message : "Unexpected server error";
  // Never leak internals to the caller; the detail goes to the server log.
  console.error("[api] unhandled error:", error);
  return new AppError(
    process.env.NODE_ENV === "production" ? "Internal server error" : message,
    500,
    "INTERNAL_ERROR",
  );
}
