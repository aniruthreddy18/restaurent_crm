/** Every error the API layer knows how to turn into a clean HTTP response. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Request validation failed", details?: unknown) {
    super(message, 422, "VALIDATION_ERROR", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(entity = "Resource") {
    super(`${entity} not found`, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource conflict", details?: unknown) {
    super(message, 409, "CONFLICT", details);
  }
}

export class RateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("Too many requests", 429, "RATE_LIMITED", { retryAfterSeconds });
  }
}

/** Raised when a business invariant (not a shape problem) is violated. */
export class BusinessRuleError extends AppError {
  constructor(message: string, code = "BUSINESS_RULE_VIOLATION", details?: unknown) {
    super(message, 400, code, details);
  }
}
