import { AdminAuthService } from "./admin/admin-auth.service";
import { AdminGuard } from "./admin/admin.guard";
import { AdminService } from "./admin/admin.service";
import { AiService } from "./ai/ai.service";
import { InboxAiService } from "./ai/inbox-ai.service";
import { AnalyticsService } from "./analytics/analytics.service";
import { AuditService } from "./audit/audit.service";
import { AuthGuard } from "./auth/auth.guard";
import { AuthService } from "./auth/auth.service";
import { PasswordResetService } from "./auth/password-reset.service";
import { TokensService } from "./auth/tokens.service";
import { AutomationRunner } from "./automations/automation.runner";
import { AutomationsService } from "./automations/automations.service";
import { BillingJob } from "./billing/billing.job";
import { BillingService } from "./billing/billing.service";
import { EntitlementsService } from "./billing/entitlements.service";
import { createPaymentProvider } from "./billing/provider";
import { ChatService } from "./chat/chat.service";
import { ChatEvents } from "./chat/events";
import { ErrorReporter } from "./common/error-reporter";
import { JobsMonitor } from "./common/jobs-monitor";
import { JwtService } from "./common/jwt";
import { config } from "./config";
import { ActivityService } from "./crm/activity.service";
import { ContactsService } from "./crm/contacts.service";
import { DealsService } from "./crm/deals.service";
import { CrmSettingsService } from "./crm/settings.service";
import { ExportService } from "./crm/export.service";
import { ImportService } from "./crm/import.service";
import { DashboardService } from "./dashboard/dashboard.service";
import { DepartmentsService } from "./departments/departments.service";
import { RolesService } from "./roles/roles.service";
import { ChannelsService } from "./inbox/channels.service";
import { InboxEvents } from "./inbox/events";
import { InboxService } from "./inbox/inbox.service";
import { IngestService } from "./inbox/ingest.service";
import { MetaClient } from "./inbox/meta.client";
import { WebhooksService } from "./inbox/webhooks.service";
import { MailService } from "./mail/mail.service";
import { MembersService } from "./members/members.service";
import { NotificationsService } from "./notifications/notifications.service";
import { Database } from "./db/database";
import { createFileStorage } from "./storage/storage.service";
import { SupportService } from "./support/support.service";
import { FilesService } from "./tasks/files.service";
import { OverdueJob } from "./tasks/overdue.job";
import { ProjectsService } from "./tasks/projects.service";
import { TasksService } from "./tasks/tasks.service";
import { TeamService } from "./team/team.service";

/** Wires every service once, in dependency order. */
export function createServices() {
  const db = new Database(config().DATABASE_URL);
  const jwt = new JwtService(config().JWT_SECRET, "axis-api");
  // BILLING_PROVIDER: manual (platform-managed) or demo; Payriff / Epoint plug in here without touching callers
  const provider = createPaymentProvider();
  const storage = createFileStorage();

  const errors = new ErrorReporter(db);
  const monitor = new JobsMonitor(errors);
  const audit = new AuditService();
  const entitlements = new EntitlementsService();
  const activity = new ActivityService();
  const inboxEvents = new InboxEvents();
  const chatEvents = new ChatEvents();
  const meta = new MetaClient();
  const notifications = new NotificationsService(db);
  const mail = new MailService(db, monitor);
  const ai = new AiService(db);
  const tokens = new TokensService(jwt, db);
  const automationRunner = new AutomationRunner(db, notifications, entitlements, inboxEvents, monitor);
  const ingest = new IngestService(inboxEvents, automationRunner);
  const tasks = new TasksService(db, notifications, storage);
  const files = new FilesService(db, tasks, storage);
  const inbox = new InboxService(db, inboxEvents, meta, activity, mail, entitlements);
  const billing = new BillingService(db, entitlements, notifications, audit, mail, provider);
  const adminAuth = new AdminAuthService(db, jwt);
  const deals = new DealsService(db, activity, audit, automationRunner);

  const services = {
    db,
    jwt,
    errors,
    monitor,
    audit,
    entitlements,
    activity,
    inboxEvents,
    chatEvents,
    notifications,
    mail,
    ai,
    tokens,
    automationRunner,
    ingest,
    tasks,
    files,
    inbox,
    billing,
    adminAuth,
    storage,
    auth: new AuthService(db, tokens, audit, entitlements, ai),
    passwordReset: new PasswordResetService(db, mail),
    members: new MembersService(db, audit, entitlements, tokens, mail),
    departments: new DepartmentsService(db, audit),
    roles: new RolesService(db, audit),
    contacts: new ContactsService(db, activity, audit, automationRunner, entitlements),
    imports: new ImportService(db, audit, entitlements),
    exports: new ExportService(db, audit),
    deals,
    crmSettings: new CrmSettingsService(db, audit, deals),
    dashboard: new DashboardService(db, activity),
    projects: new ProjectsService(db),
    overdueJob: new OverdueJob(db, monitor, notifications, automationRunner),
    team: new TeamService(db, tasks, activity),
    channels: new ChannelsService(db, ingest, mail),
    webhooks: new WebhooksService(db, ingest),
    chat: new ChatService(db, chatEvents, files, storage),
    billingJob: new BillingJob(db, monitor, billing, notifications, provider),
    support: new SupportService(db, notifications, audit, entitlements, mail),
    analytics: new AnalyticsService(db),
    inboxAi: new InboxAiService(db, inbox, ai),
    automations: new AutomationsService(db, audit, entitlements),
    admin: new AdminService(db, audit, monitor, ai, provider, storage, entitlements, notifications),
    authGuard: new AuthGuard(tokens, db, entitlements),
    adminGuard: new AdminGuard(adminAuth),
  };
  return services;
}

export type Services = ReturnType<typeof createServices>;

/** Background work: in-process timers on a long-running server (each checks JOBS_ENABLED). */
export const jobsOf = (s: Services) => [s.overdueJob, s.billingJob, s.mail, s.automationRunner];
