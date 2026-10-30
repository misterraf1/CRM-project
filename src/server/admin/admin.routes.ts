import {
  adminInvoiceQuerySchema,
  adminLoginSchema,
  adminMfaVerifySchema,
  adminTenantQuerySchema,
  expenseSchema,
  extendTrialSchema,
  mfaCodeSchema,
  planCreateSchema,
  planUpdateSchema,
  subscriptionSetSchema,
  suspendSchema,
  tenantLimitsSchema,
  ticketMessageSchema,
  ticketUpdateSchema,
  TICKET_STATUSES,
  type TicketStatus,
} from "@/shared";
import { config } from "../config";
import { currentContext } from "../common/context";
import type { Services } from "../container";
import type { Router } from "../http/router";

const authLimit = { limit: () => config().AUTH_RATE_LIMIT, ttl: 60_000 };

export function adminRoutes(router: Router, s: Services) {
  // Platform staff sign-in. Separate from /v1/auth: other issuer, no tenant.
  router.group("/v1/admin/auth", { public: true }, (r) => {
    r.post("login", { throttle: authLimit, status: 200, body: adminLoginSchema }, ({ body }) => s.adminAuth.login(body.email, body.password));

    r.post("mfa/verify", { throttle: authLimit, status: 200, body: adminMfaVerifySchema }, ({ body }) => s.adminAuth.verifyMfa(body.challenge, body.code));

    r.post("logout", { admin: true, withoutMfa: true, status: 204 }, async () => {
      await s.adminAuth.logout(currentContext().adminSessionId!);
    });

    r.get("me", { admin: true, withoutMfa: true }, () => s.adminAuth.me(currentContext().userId!));

    r.post("mfa/setup", { admin: true, withoutMfa: true }, () => s.adminAuth.setupMfa(currentContext().userId!));

    r.post("mfa/enable", { admin: true, withoutMfa: true, throttle: authLimit, status: 200, body: mfaCodeSchema }, ({ body }) =>
      s.adminAuth.enableMfa(currentContext().userId!, body.code),
    );

    r.post("mfa/recovery-codes", { admin: true, throttle: authLimit, status: 200, body: mfaCodeSchema }, ({ body }) =>
      s.adminAuth.regenerateRecoveryCodes(currentContext().userId!, body.code),
    );

    r.post("mfa/disable", { admin: true, throttle: authLimit, status: 204, body: mfaCodeSchema }, async ({ body }) => {
      await s.adminAuth.disableMfa(currentContext().userId!, body.code);
    });
  });

  router.group("/v1/admin", { admin: true }, (r) => {
    r.get("overview", () => s.admin.overview());

    r.get("tenants", { query: adminTenantQuerySchema }, ({ query }) => s.admin.tenants(query));

    r.get("tenants/:id", ({ params }) => s.admin.tenant(params.id!));

    r.post("tenants/:id/extend-trial", { superAdminOnly: true, status: 204, body: extendTrialSchema }, async ({ params, body }) => {
      await s.admin.extendTrial(params.id!, body.days);
    });

    r.post("tenants/:id/suspend", { superAdminOnly: true, status: 204, body: suspendSchema }, async ({ params, body }) => {
      await s.admin.suspend(params.id!, body.reason);
    });

    r.post("tenants/:id/unsuspend", { superAdminOnly: true, status: 204 }, async ({ params }) => {
      await s.admin.unsuspend(params.id!);
    });

    r.post("tenants/:id/subscription", { superAdminOnly: true, status: 204, body: subscriptionSetSchema }, async ({ params, body }) => {
      await s.admin.setSubscription(params.id!, body);
    });

    r.post("tenants/:id/limits", { superAdminOnly: true, status: 204, body: tenantLimitsSchema }, async ({ params, body }) => {
      await s.admin.setLimits(params.id!, body);
    });

    r.get("plans", () => s.admin.plans());

    r.post("plans", { superAdminOnly: true, body: planCreateSchema }, ({ body }) => s.admin.createPlan(body));

    r.patch("plans/:code", { superAdminOnly: true, body: planUpdateSchema }, ({ params, body }) => s.admin.updatePlan(params.code!, body));

    r.get("invoices", { query: adminInvoiceQuerySchema }, ({ query }) => s.admin.invoices(query));

    r.get("expenses", { superAdminOnly: true }, () => s.admin.expenses());

    r.post("expenses", { superAdminOnly: true, body: expenseSchema }, ({ body }) => s.admin.addExpense(body));

    r.delete("expenses/:id", { superAdminOnly: true, status: 204 }, async ({ params }) => {
      await s.admin.deleteExpense(params.id!);
    });

    r.get("tickets", ({ search }) => {
      const status = search.get("status");
      return s.support.adminList({ status: TICKET_STATUSES.includes(status as TicketStatus) ? (status as TicketStatus) : undefined });
    });

    r.get("tickets/:id", ({ params }) => s.support.adminGet(params.id!));

    r.post("tickets/:id/messages", { body: ticketMessageSchema }, ({ params, body }) => s.support.adminReply(params.id!, body.body));

    r.patch("tickets/:id", { body: ticketUpdateSchema }, ({ params, body }) => s.support.adminUpdate(params.id!, body));

    r.get("system", () => s.admin.system());
  });
}
