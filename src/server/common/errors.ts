import type { ErrorCode } from "@/shared";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  SEAT_LIMIT: 402,
  FEATURE_NOT_IN_PLAN: 402,
  SUBSCRIPTION_INACTIVE: 402,
  PAYMENT_FAILED: 402,
  STORAGE_LIMIT: 402,
  FILE_TOO_LARGE: 413,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  CONFLICT: 409,
  LAST_OWNER: 409,
  INVITE_INVALID: 410,
  WINDOW_CLOSED: 409,
  CHANNEL_ERROR: 502,
  MFA_REQUIRED: 401,
  MFA_INVALID: 401,
  MFA_SETUP_REQUIRED: 403,
  TOKEN_INVALID: 400,
  AI_UNAVAILABLE: 503,
  AI_LIMIT: 402,
  /** Contacts / automations over the plan's (or company's) limit */
  PLAN_LIMIT: 402,
  ROLE_IN_USE: 409,
  /** Self-service payments are off: the platform manages subscriptions by hand */
  BILLING_MANUAL: 409,
  /** A quote's discount is over the company limit and nobody has approved it yet */
  APPROVAL_REQUIRED: 409,
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
