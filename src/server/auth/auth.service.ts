import type { AuthTokens, LoginInput, MeResponse, SignupInput } from "@/shared";
import { resolvePermissions } from "@/shared";
import { AiService } from "../ai/ai.service";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService, subscriptionOf } from "../billing/entitlements.service";
import { config } from "../config";
import { authedContext } from "../common/context";
import { AppError } from "../common/errors";
import { newId } from "../common/ids";
import type { Database } from "../db/database";
import { isDuplicateKey } from "../db/errors";
import { hashPassword, verifyPassword } from "./password";
import { slugify } from "./slug";
import { TokensService } from "./tokens.service";
import { insertPipeline } from "../crm/settings.service";

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly ai: AiService,
  ) {}

  /** Creates company + owner account and starts the trial. */
  async signup(input: SignupInput): Promise<AuthTokens> {
    if (await this.db.current.user.count({ email: input.email })) {
      throw new AppError("EMAIL_TAKEN", "An account with this email already exists");
    }
    const passwordHash = await hashPassword(input.password);
    // The trial runs on the top plan so every feature can be tried before choosing
    const plan = await this.db.current.plan.get({ code: "BUSINESS" });
    const base = slugify(input.companyName);
    const tenantId = newId("tnt");
    const userId = newId("usr");

    // Two companies with the same name signing up at once race for the same address:
    // the loser takes the next free one instead of failing
    for (let attempt = 1; ; attempt++) {
      const slug = await this.freeSlug(base);
      try {
        return await this.db.scoped(
          async (tx) => {
            const now = new Date();
            const trialEnd = new Date(now.getTime() + config().TRIAL_DAYS * 86_400_000);
            await tx.user.insertOne({ id: userId, email: input.email, fullName: input.fullName, passwordHash });
            await tx.tenant.insertOne({ id: tenantId, slug, name: input.companyName, status: "TRIALING" });
            await tx.subscription.insertOne({ tenantId, planId: plan.id, status: "TRIALING", trialEndsAt: trialEnd, currentPeriodStart: now, currentPeriodEnd: trialEnd });
            await tx.membership.insertOne({ tenantId, userId, role: "OWNER", status: "ACTIVE", joinedAt: now });
            await insertPipeline(tx, tenantId, "Satış", true);
            await this.audit.log(tx, { action: "tenant.created", entityType: "tenant", entityId: tenantId, tenantId, actorId: userId });
            return this.tokens.issue(tx, userId, tenantId);
          },
          { tenantId, userId },
        );
      } catch (e) {
        // Lost a race on email or slug between the checks above and the insert
        if (!isDuplicateKey(e)) throw e;
        if (await this.db.current.user.count({ email: input.email })) throw new AppError("EMAIL_TAKEN", "An account with this email already exists");
        if (attempt >= 3) throw new AppError("CONFLICT", "Please try again");
      }
    }
  }

  /** First free workspace address: "acme", then "acme-2", "acme-3"… */
  private async freeSlug(base: string) {
    for (let n = 1; n <= 50; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      // Other tenants are invisible to tenant-scoped queries; this check only learns
      // whether a public subdomain is taken
      const taken = await this.db.system.tenant.count({ slug: candidate });
      if (!taken) return candidate;
    }
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const user = await this.db.current.user.findOne({ email: input.email });
    if (!(await verifyPassword(user?.passwordHash, input.password)) || !user) {
      throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect");
    }

    // Step 1 — user scope: which workspaces may this account enter?
    const memberships = await this.db.scoped(
      async (tx) => {
        const rows = await tx.membership.find({ userId: user.id, status: "ACTIVE" }, { sort: { joinedAt: -1 } });
        const tenants = await tx.tenant.find({ id: { $in: rows.map((m) => m.tenantId) }, status: { $ne: "CANCELED" } }, { projection: { id: 1, slug: 1 } });
        const byId = new Map(tenants.map((t) => [t.id, t]));
        return rows.filter((m) => byId.has(m.tenantId)).map((m) => ({ ...m, tenant: byId.get(m.tenantId)! }));
      },
      { userId: user.id },
    );
    const target = input.tenantSlug ? memberships.find((m) => m.tenant.slug === input.tenantSlug) : memberships[0];
    if (!target) throw new AppError("FORBIDDEN", "No active workspace for this account");

    // Step 2 — tenant scope: writes are only accepted inside the chosen workspace
    return this.db.scoped(
      async (tx) => {
        await tx.user.update({ id: user.id }, { $set: { lastLoginAt: new Date() } });
        await this.audit.log(tx, { action: "auth.login", entityType: "user", entityId: user.id, tenantId: target.tenantId, actorId: user.id });
        return this.tokens.issue(tx, user.id, target.tenantId);
      },
      { tenantId: target.tenantId, userId: user.id },
    );
  }

  /** Issues tokens for another workspace of the same user and ends the current session. */
  async switchTenant(tenantId: string): Promise<AuthTokens> {
    const ctx = authedContext();
    const tokens = await this.db.scoped(
      async (tx) => {
        const membership = await tx.membership.findOne({ tenantId, userId: ctx.userId, status: "ACTIVE" });
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
    return this.db.scoped(async (tx) => {
      const [user, membership, tenant, subscription, seats, [rows, tenants], aiUsage] = await Promise.all([
        tx.user.get({ id: ctx.userId }),
        tx.membership.get({ id: ctx.membershipId }),
        tx.tenant.get({ id: ctx.tenantId }),
        subscriptionOf(tx, ctx.tenantId),
        this.entitlements.seats(tx, ctx.tenantId),
        tx.membership
          .find({ userId: ctx.userId, status: "ACTIVE" }, { sort: { joinedAt: 1 } })
          .then(async (rows) => [rows, new Map((await tx.tenant.find({ id: { $in: rows.map((m) => m.tenantId) } })).map((t) => [t.id, t]))] as const),
        this.ai.usage(tx, ctx.tenantId),
      ]);
      const role = membership.roleId ? await tx.role.findOne({ id: membership.roleId, tenantId: ctx.tenantId }) : null;
      const memberships = rows.filter((m) => tenants.has(m.tenantId)).map((m) => ({ ...m, tenant: tenants.get(m.tenantId)! }));
      return {
        user: { id: user.id, fullName: user.fullName, email: user.email, locale: user.locale },
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, currency: tenant.currency, timezone: tenant.timezone },
        membership: {
          id: membership.id,
          role: membership.role,
          customRole: role ? { id: role.id, name: role.name } : null,
          title: membership.title,
          departmentId: membership.departmentId,
        },
        permissions: resolvePermissions(membership.role, membership.permissions, role?.permissions),
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
        ai: { available: this.ai.available, ...aiUsage },
      };
    });
  }
}
