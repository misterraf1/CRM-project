import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthTokens, LoginInput, MeResponse, SignupInput } from "@axis/shared";
import { resolvePermissions } from "@axis/shared";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService } from "../billing/entitlements.service";
import { config } from "../config";
import { authedContext } from "../common/context";
import { AppError } from "../common/errors";
import { newId } from "../common/ids";
import { PrismaService } from "../prisma/prisma.service";
import { hashPassword, verifyPassword } from "./password";
import { slugify } from "./slug";
import { TokensService } from "./tokens.service";

const DEFAULT_STAGES = [
  { name: "Yeni", probability: 10, kind: "open" },
  { name: "Kvalifikasiya", probability: 25, kind: "open" },
  { name: "Təklif", probability: 50, kind: "open" },
  { name: "Danışıqlar", probability: 75, kind: "open" },
  { name: "Qazanıldı", probability: 100, kind: "won" },
  { name: "İtirildi", probability: 0, kind: "lost" },
];

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Creates company + owner account and starts the trial. */
  async signup(input: SignupInput): Promise<AuthTokens> {
    if (await this.prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
      throw new AppError("EMAIL_TAKEN", "An account with this email already exists");
    }
    const passwordHash = await hashPassword(input.password);
    // The trial runs on the top plan so every feature can be tried before choosing
    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { code: "BUSINESS" } });
    const slug = await this.freeSlug(slugify(input.companyName));
    const tenantId = newId("tnt");
    const userId = newId("usr");

    try {
      return await this.prisma.scoped(
        async (tx) => {
          const now = new Date();
          const trialEnd = new Date(now.getTime() + config().TRIAL_DAYS * 86_400_000);
          await tx.user.create({ data: { id: userId, email: input.email, fullName: input.fullName, passwordHash } });
          await tx.tenant.create({ data: { id: tenantId, slug, name: input.companyName, status: "TRIALING" } });
          await tx.subscription.create({
            data: { tenantId, planId: plan.id, status: "TRIALING", trialEndsAt: trialEnd, currentPeriodStart: now, currentPeriodEnd: trialEnd },
          });
          await tx.membership.create({ data: { tenantId, userId, role: "OWNER", status: "ACTIVE", joinedAt: now } });
          await tx.pipeline.create({
            data: {
              tenantId,
              name: "Satış",
              isDefault: true,
              stages: { create: DEFAULT_STAGES.map((s, order) => ({ ...s, order, tenantId })) },
            },
          });
          await this.audit.log(tx, { action: "tenant.created", entityType: "tenant", entityId: tenantId, tenantId, actorId: userId });
          return this.tokens.issue(tx, userId, tenantId);
        },
        { tenantId, userId },
      );
    } catch (e) {
      // Lost a race on email or slug between the checks above and the insert
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const emailTaken = await this.prisma.user.count({ where: { email: input.email } });
        throw emailTaken
          ? new AppError("EMAIL_TAKEN", "An account with this email already exists")
          : new AppError("CONFLICT", "Please try again");
      }
      throw e;
    }
  }

  /** First free workspace address: "acme", then "acme-2", "acme-3"… */
  private async freeSlug(base: string) {
    for (let n = 1; n <= 50; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      // Other tenants are invisible to tenant-scoped queries; this check only learns
      // whether a public subdomain is taken
      const taken = await this.prisma.system(() => this.prisma.tenant.count({ where: { slug: candidate } }));
      if (!taken) return candidate;
    }
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!(await verifyPassword(user?.passwordHash, input.password)) || !user) {
      throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect");
    }

    // Step 1 — user scope: which workspaces may this account enter?
    const memberships = await this.prisma.scoped(
      (tx) =>
        tx.membership.findMany({
          where: { userId: user.id, status: "ACTIVE", tenant: { status: { not: "CANCELED" } } },
          include: { tenant: { select: { slug: true } } },
          orderBy: { joinedAt: "desc" },
        }),
      { userId: user.id },
    );
    const target = input.tenantSlug ? memberships.find((m) => m.tenant.slug === input.tenantSlug) : memberships[0];
    if (!target) throw new AppError("FORBIDDEN", "No active workspace for this account");

    // Step 2 — tenant scope: writes are only accepted inside the chosen workspace
    return this.prisma.scoped(
      async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await this.audit.log(tx, { action: "auth.login", entityType: "user", entityId: user.id, tenantId: target.tenantId, actorId: user.id });
        return this.tokens.issue(tx, user.id, target.tenantId);
      },
      { tenantId: target.tenantId, userId: user.id },
    );
  }

  /** Issues tokens for another workspace of the same user and ends the current session. */
  async switchTenant(tenantId: string): Promise<AuthTokens> {
    const ctx = authedContext();
    const tokens = await this.prisma.scoped(
      async (tx) => {
        const membership = await tx.membership.findFirst({ where: { tenantId, userId: ctx.userId, status: "ACTIVE" } });
        if (!membership) throw new AppError("NOT_FOUND", "Workspace not found");
        return this.tokens.issue(tx, ctx.userId, tenantId);
      },
      { tenantId, userId: ctx.userId },
    );
    await this.tokens.revokeSession(ctx.sessionId);
    return tokens;
  }

  async me(): Promise<MeResponse> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const [user, membership, tenant, subscription, seats, memberships] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: ctx.userId } }),
        tx.membership.findUniqueOrThrow({ where: { id: ctx.membershipId } }),
        tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
        tx.subscription.findUniqueOrThrow({ where: { tenantId: ctx.tenantId }, include: { plan: true } }),
        this.entitlements.seats(tx, ctx.tenantId),
        tx.membership.findMany({
          where: { userId: ctx.userId, status: "ACTIVE" },
          include: { tenant: { select: { name: true, slug: true } } },
          orderBy: { joinedAt: "asc" },
        }),
      ]);
      return {
        user: { id: user.id, fullName: user.fullName, email: user.email, locale: user.locale },
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, currency: tenant.currency, timezone: tenant.timezone },
        membership: { id: membership.id, role: membership.role, title: membership.title, departmentId: membership.departmentId },
        permissions: resolvePermissions(membership.role, membership.permissions),
        subscription: {
          plan: subscription.plan.code,
          status: subscription.status,
          trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
          graceEndsAt: subscription.graceEndsAt?.toISOString() ?? null,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          seats,
          features: this.entitlements.features(subscription),
        },
        memberships: memberships.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenant.name, slug: m.tenant.slug, role: m.role })),
      };
    });
  }
}
