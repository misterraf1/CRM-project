import { adminRoutes } from "./admin/admin.routes";
import { analyticsRoutes } from "./analytics/analytics.routes";
import { auditRoutes } from "./audit/audit.routes";
import { authRoutes } from "./auth/auth.routes";
import { automationsRoutes } from "./automations/automations.routes";
import { billingRoutes } from "./billing/billing.routes";
import { chatRoutes } from "./chat/chat.routes";
import { createServices, jobsOf, type Services } from "./container";
import { contactsRoutes } from "./crm/contacts.routes";
import { dealsRoutes } from "./crm/deals.routes";
import { crmSettingsRoutes } from "./crm/settings.routes";
import { dataRoutes } from "./crm/data.routes";
import { dashboardRoutes } from "./dashboard/dashboard.routes";
import { departmentsRoutes } from "./departments/departments.routes";
import { rolesRoutes } from "./roles/roles.routes";
import { salesRoutes } from "./sales/sales.routes";
import { healthRoutes } from "./health.routes";
import { ApiApp, type ClientInfo } from "./http/app";
import { Router } from "./http/router";
import { Throttler } from "./http/throttle";
import { inboxRoutes } from "./inbox/inbox.routes";
import { webhooksRoutes } from "./inbox/webhooks.routes";
import { widgetRoutes } from "./inbox/widget.routes";
import { membersRoutes } from "./members/members.routes";
import { notificationsRoutes } from "./notifications/notifications.routes";
import { supportRoutes } from "./support/support.routes";
import { tasksRoutes } from "./tasks/tasks.routes";
import { teamRoutes } from "./team/team.routes";

export type { ClientInfo } from "./http/app";

export interface ApiServer {
  services: Services;
  handle(req: Request, client?: ClientInfo): Promise<Response>;
  /** Runs every background job once (serverless cron; tests call jobs directly) */
  runJobs(): Promise<void>;
  close(): Promise<void>;
}

/** Builds the backend: services, route table and background timers. */
export function createApi(): ApiServer {
  const services = createServices();
  const router = new Router();
  for (const register of [
    healthRoutes,
    authRoutes,
    membersRoutes,
    departmentsRoutes,
    rolesRoutes,
    salesRoutes,
    auditRoutes,
    contactsRoutes,
    dealsRoutes,
    crmSettingsRoutes,
    dataRoutes,
    dashboardRoutes,
    tasksRoutes,
    notificationsRoutes,
    teamRoutes,
    inboxRoutes,
    webhooksRoutes,
    widgetRoutes,
    chatRoutes,
    billingRoutes,
    supportRoutes,
    analyticsRoutes,
    automationsRoutes,
    adminRoutes,
  ]) {
    register(router, services);
  }
  const app = new ApiApp(router, new Throttler(services.jwt), services.authGuard, services.adminGuard, services.errors);
  const jobs = jobsOf(services);
  for (const job of jobs) job.start();

  const m = services.monitor;
  return {
    services,
    handle: (req, client) => app.handle(req, client),
    async runJobs() {
      await m.track("overdue-tasks", () => services.overdueJob.run());
      await m.track("billing", () => services.billingJob.run());
      await m.track("automations", () => services.automationRunner.drain());
      await m.track("mail", () => services.mail.send());
    },
    async close() {
      for (const job of jobs) job.stop();
      await services.errors.flush();
      await services.db.close();
    },
  };
}

// One backend per server process. Kept on globalThis so every Next.js bundle that
// imports this module (route handlers, server components, instrumentation) shares
// the same database pool, event buses (live updates) and rate-limit counters.
const GLOBAL_KEY = Symbol.for("axis.api");
type GlobalWithApi = typeof globalThis & { [GLOBAL_KEY]?: ApiServer };

export function getApi(): ApiServer {
  const g = globalThis as GlobalWithApi;
  return (g[GLOBAL_KEY] ??= createApi());
}
