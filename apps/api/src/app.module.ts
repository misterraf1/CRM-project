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
import { ErrorFilter } from "./common/error.filter";
import { config } from "./config";
import { DepartmentsController } from "./departments/departments.controller";
import { DepartmentsService } from "./departments/departments.service";
import { HealthController } from "./health.controller";
import { InvitesController, MembersController } from "./members/members.controller";
import { MembersService } from "./members/members.service";
import { PrismaModule } from "./prisma/prisma.module";

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
  ],
  providers: [
    AuthService,
    TokensService,
    MembersService,
    DepartmentsService,
    AuditService,
    EntitlementsService,
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
