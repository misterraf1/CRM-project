import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuditController } from "./audit/audit.controller";
import { AuditService } from "./audit/audit.service";
import { AuthController, MeController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { AuthService } from "./auth/auth.service";
import { TokensService } from "./auth/tokens.service";
import { EntitlementsService } from "./billing/entitlements.service";
import { ContextMiddleware } from "./common/context.middleware";
import { ActivityService } from "./crm/activity.service";
import { ContactsController } from "./crm/contacts.controller";
import { ContactsService } from "./crm/contacts.service";
import { DealsController } from "./crm/deals.controller";
import { DealsService } from "./crm/deals.service";
import { DashboardController } from "./dashboard/dashboard.controller";
import { DashboardService } from "./dashboard/dashboard.service";
import { ErrorFilter } from "./common/error.filter";
import { config } from "./config";
import { DepartmentsController } from "./departments/departments.controller";
import { DepartmentsService } from "./departments/departments.service";
import { HealthController } from "./health.controller";
import { InvitesController, MembersController } from "./members/members.controller";
import { MembersService } from "./members/members.service";
import { ChannelsService } from "./inbox/channels.service";
import { InboxEvents } from "./inbox/events";
import { InboxController } from "./inbox/inbox.controller";
import { InboxService } from "./inbox/inbox.service";
import { IngestService } from "./inbox/ingest.service";
import { MetaClient } from "./inbox/meta.client";
import { WebhooksController } from "./inbox/webhooks.controller";
import { WebhooksService } from "./inbox/webhooks.service";
import { WidgetController } from "./inbox/widget.controller";
import { NotificationsController } from "./notifications/notifications.controller";
import { NotificationsService } from "./notifications/notifications.service";
import { PrismaModule } from "./prisma/prisma.module";
import { FILE_STORAGE, LocalFileStorage } from "./storage/storage.service";
import { FilesService } from "./tasks/files.service";
import { OverdueJob } from "./tasks/overdue.job";
import { ProjectsService } from "./tasks/projects.service";
import { TasksController } from "./tasks/tasks.controller";
import { TasksService } from "./tasks/tasks.service";
import { TeamController } from "./team/team.controller";
import { TeamService } from "./team/team.service";

// In-memory throttling for a single instance; moves to Redis storage with horizontal scaling.
@Module({
  imports: [
    PrismaModule,
    JwtModule.register({ secret: config().JWT_SECRET, signOptions: { algorithm: "HS256", issuer: "axis-api" }, verifyOptions: { algorithms: ["HS256"], issuer: "axis-api" } }),
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 300 }]),
  ],
  controllers: [
    HealthController,
    AuthController,
    MeController,
    MembersController,
    InvitesController,
    DepartmentsController,
    AuditController,
    ContactsController,
    DealsController,
    DashboardController,
    TasksController,
    NotificationsController,
    TeamController,
    InboxController,
    WebhooksController,
    WidgetController,
  ],
  providers: [
    AuthService,
    TokensService,
    MembersService,
    DepartmentsService,
    AuditService,
    EntitlementsService,
    ActivityService,
    ContactsService,
    DealsService,
    DashboardService,
    TasksService,
    FilesService,
    ProjectsService,
    NotificationsService,
    OverdueJob,
    TeamService,
    InboxEvents,
    MetaClient,
    IngestService,
    InboxService,
    ChannelsService,
    WebhooksService,
    { provide: FILE_STORAGE, useClass: LocalFileStorage },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ContextMiddleware).forRoutes("*");
  }
}
