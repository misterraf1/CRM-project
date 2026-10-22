import { AsyncLocalStorage } from "node:async_hooks";
import type { MemberRole, Permission } from "@axis/shared";

/**
 * Per-request identity. Filled by AuthGuard from the verified token and the
 * membership row; the tenant id never comes from the URL or the body.
 */
export interface RequestContext {
  ip?: string;
  userAgent?: string;
  userId?: string;
  tenantId?: string;
  membershipId?: string;
  sessionId?: string;
  role?: MemberRole;
  permissions?: Permission[];
}

export type AuthedContext = Required<Pick<RequestContext, "userId" | "tenantId" | "membershipId" | "sessionId" | "role" | "permissions">> &
  RequestContext;

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext {
  return requestContext.getStore() ?? {};
}

export function authedContext(): AuthedContext {
  const ctx = currentContext();
  if (!ctx.userId || !ctx.tenantId || !ctx.membershipId || !ctx.role || !ctx.permissions || !ctx.sessionId) {
    throw new Error("authedContext() called outside an authenticated request");
  }
  return ctx as AuthedContext;
}
