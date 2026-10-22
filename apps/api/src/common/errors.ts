import type { ErrorCode } from "@axis/shared";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  SEAT_LIMIT: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  CONFLICT: 409,
  LAST_OWNER: 409,
  INVITE_INVALID: 410,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string = code,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`);
export const forbidden = (message = "Not allowed") => new AppError("FORBIDDEN", message);
