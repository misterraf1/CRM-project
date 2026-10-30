import type { MemberRole, Permission } from "./permissions";

// Response contracts of the NestJS API (consumed by apps/web).

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_CREDENTIALS"
  | "EMAIL_TAKEN"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SEAT_LIMIT"
  | "STORAGE_LIMIT"
  | "FILE_TOO_LARGE"
  | "FEATURE_NOT_IN_PLAN"
  | "SUBSCRIPTION_INACTIVE"
  | "PAYMENT_FAILED"
  | "WINDOW_CLOSED"
  | "CHANNEL_ERROR"
  | "INVITE_INVALID"
  | "LAST_OWNER"
  | "RATE_LIMITED"
  | "MFA_REQUIRED"
  | "MFA_INVALID"
  | "MFA_SETUP_REQUIRED"
  | "TOKEN_INVALID"
  | "AI_UNAVAILABLE"
  | "AI_LIMIT"
  | "PLAN_LIMIT"
  | "ROLE_IN_USE"
  | "BILLING_MANUAL"
  | "APPROVAL_REQUIRED"
  | "INTERNAL";

export interface ApiError {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface AuthTokens {
  accessToken: string;
  /** Seconds until the access token expires */
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: string;
}

export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";

export interface MeResponse {
  user: { id: string; fullName: string; email: string; locale: "AZ" | "EN" | "RU" };
  tenant: { id: string; name: string; slug: string; currency: string; timezone: string };
  membership: { id: string; role: MemberRole; customRole: { id: string; name: string } | null; title: string | null; departmentId: string | null };
  permissions: Permission[];
  subscription: {
    plan: string;
    status: SubscriptionStatus;
    trialEndsAt: string | null;
    currentPeriodEnd: string;
    /** PAST_DUE: access continues until then, then the account is suspended */
    graceEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
    seats: { used: number; limit: number };
    /** Plan features in effect (trial = everything) */
    features: string[];
  };
  /** AI assistant: whether the server has it connected, and this month's usage against the plan */
  ai: { available: boolean; used: number; limit: number };
  memberships: { tenantId: string; tenantName: string; slug: string; role: MemberRole }[];
}

export type MemberStatus = "INVITED" | "ACTIVE" | "DISABLED";

export interface MemberDto {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  role: MemberRole;
  /** Custom role in place of the built-in role's permissions */
  customRole: { id: string; name: string } | null;
  status: MemberStatus;
  title: string | null;
  departmentId: string | null;
  invitedAt: string | null;
  joinedAt: string | null;
}

export interface InviteCreatedResponse {
  member: MemberDto;
  /** Path the invitee opens; also emailed to them when SMTP is configured */
  invitePath: string;
  /** "queued": the invitation email is on its way; "not_configured": share the link yourself */
  emailDelivery: "queued" | "not_configured";
  expiresAt: string;
}

export interface InvitePreview {
  tenantName: string;
  email: string;
  fullName: string;
  role: MemberRole;
  /** Name of the custom role, when the invite carries one */
  customRole: string | null;
  /** False when the invitee already has an account: they confirm with their existing password. */
  needsAccount: boolean;
  expiresAt: string;
}

export interface DepartmentDto {
  id: string;
  name: string;
  headId: string | null;
  parentId: string | null;
  memberCount: number;
}

export interface AuditLogDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: { id: string; fullName: string } | null;
  diff: unknown;
  createdAt: string;
}
