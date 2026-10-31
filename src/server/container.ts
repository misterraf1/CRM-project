import type { AutomationTrigger } from "@/shared";
import { afterResponse } from "./common/after-response";
import { AdminAuthService } from "./admin/admin-auth.service";
import { MfaService } from "./auth/mfa";
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
import { AttentionService } from "./dashboard/attention.service";
import { SearchService } from "./search/search.service";
import { SalesDocsService } from "./sales/docs.service";
import { ProductsService } from "./sales/products.service";
import { OrdersService } from "./sales/orders.service";
import { PublicDocsService } from "./sales/public-docs.service";
import { ChannelsService } from "./inbox/channels.service";
import { InboxEvents } from "./inbox/events";
import { InboxService } from "./inbox/inbox.service";
import { IngestService } from "./inbox/ingest.service";
import { MetaClient } from "./inbox/meta.client";
import { TelegramClient } from "./inbox/telegram.client";
import { WebhooksService } from "./inbox/webhooks.service";
import { MailService } from "./mail/mail.service";
import { MembersService } from "./members/members.service";
import { NotificationsService } from "./notifications/notifications.service";
import { Database } from "./db/database";
import { createFileStorage } from "./storage/storage.service";
import { SupportService } from "./support/support.service";
import { FilesService } from "./tasks/files.service";
import { CampaignsService } from "./growth/campaigns.service";
import { FormsService } from "./growth/forms.service";
import { PortalService } from "./growth/portal.service";
import { ReportsService } from "./analytics/reports.service";
import { OnboardingService } from "./onboarding/onboarding.service";
import { CrmAiService } from "./ai/crm-ai.service";
import { Signals } from "./automations/signals";
import { CasesService } from "./service/cases.service";
import { RenewalsService } from "./service/renewals.service";
import { TargetsService } from "./service/targets.service";
import { OverdueJob } from "./tasks/overdue.job";
import { CalendarService } from "./calendar/calendar.service";
import { Reminders } from "./calendar/reminders";
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
  const telegram = new TelegramClient();
  const notifications = new NotificationsService(db);
  const mail = new MailService(db, monitor);
  const ai = new AiService(db);
  const tokens = new TokensService(jwt, db);
  const automationRunner = new AutomationRunner(db, notifications, entitlements, inboxEvents, monitor, activity, mail);
  const ingest = new IngestService(inboxEvents, automationRunner, storage);
  const tasks = new TasksService(db, notifications, storage);
  const files = new FilesService(db, tasks, storage);
  const inbox = new InboxService(db, inboxEvents, meta, activity, mail, entitlements, telegram, files);
  // Timeline events that start automation rules
  const activityTriggers: Partial<Record<string, AutomationTrigger>> = { quote_accepted: "quote.accepted", invoice_paid: "invoice.paid", order_done: "order.done" };
  const renewals = new RenewalsService(db, notifications);
  activity.onRecorded = async (tx, tenantId, { type, payload }) => {
    // A paid invoice opens the next period of the recurring services on it
    if (type === "invoice_paid") await renewals.fromPaidInvoice(tx, tenantId, String(payload.docId));
    const trigger = activityTriggers[type];
    if (trigger === "order.done") await automationRunner.enqueue(tx, tenantId, trigger, { orderId: String(payload.orderId) });
    else if (trigger) await automationRunner.enqueue(tx, tenantId, trigger, { docId: String(payload.docId) });
  };
  ingest.onAutoReply = (tenantId, messageId) => afterResponse(() => inbox.deliverStored(tenantId, messageId));
  const billing = new BillingService(db, entitlements, notifications, audit, mail, provider);
  const mfa = new MfaService(db);
  const adminAuth = new AdminAuthService(db, jwt, mfa);
  const reminders = new Reminders(db, notifications);
  const cases = new CasesService(db, audit, activity, notifications, automationRunner);
  const signals = new Signals(db, automationRunner);
  const deals = new DealsService(db, activity, audit, automationRunner);
  const docs = new SalesDocsService(db, audit, activity, notifications, mail);
  const publicDocs = new PublicDocsService(db, docs);

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
    auth: new AuthService(db, tokens, audit, entitlements, ai, jwt, mfa),
    passwordReset: new PasswordResetService(db, mail),
    members: new MembersService(db, audit, entitlements, tokens, mail),
    departments: new DepartmentsService(db, audit),
    roles: new RolesService(db, audit),
    products: new ProductsService(db, audit),
    docs,
    publicDocs,
    orders: new OrdersService(db, audit, activity, notifications),
    contacts: new ContactsService(db, activity, audit, automationRunner, entitlements, notifications),
    imports: new ImportService(db, audit, entitlements),
    exports: new ExportService(db, audit),
    deals,
    crmSettings: new CrmSettingsService(db, audit, deals),
    dashboard: new DashboardService(db, activity),
    attention: new AttentionService(db),
    search: new SearchService(db),
    projects: new ProjectsService(db),
    reminders,
    cases,
    renewals,
    signals,
    targets: new TargetsService(db, audit),
    reports: new ReportsService(db),
    onboarding: new OnboardingService(db, audit),
    crmAi: new CrmAiService(db, ai),
    forms: new FormsService(db, audit, activity, notifications, automationRunner, entitlements),
    campaigns: new CampaignsService(db, audit, mail),
    portal: new PortalService(db, audit, activity, notifications, mail, publicDocs, files),
    // The 5-minute tick: overdue notices, reminders, then the after-sale and signal checks
    overdueJob: new OverdueJob(db, monitor, notifications, automationRunner, docs, reminders, [() => cases.notifyOverdue(), () => renewals.planTasks(), () => signals.run()]),
    calendar: new CalendarService(db, notifications, activity),
    team: new TeamService(db, tasks, activity),
    channels: new ChannelsService(db, ingest, mail, meta, telegram),
    webhooks: new WebhooksService(db, ingest, meta, telegram),
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
