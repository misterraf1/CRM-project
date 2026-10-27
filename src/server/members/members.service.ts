import { MailService } from "../mail/mail.service";
import type { Membership, User } from "../db/models";
import {
  assignableRoles,
  type AcceptInviteInput,
  type AuthTokens,
  type InviteCreatedResponse,
  type InviteInput,
  type InvitePreview,
  type MemberDto,
  type UpdateMemberInput,
} from "@/shared";
import { AuditService } from "../audit/audit.service";
import { hashPassword, verifyPassword } from "../auth/password";
import { TokensService } from "../auth/tokens.service";
import { EntitlementsService } from "../billing/entitlements.service";
import { config } from "../config";
import { authedContext } from "../common/context";
import { AppError, forbidden, notFound } from "../common/errors";
import { randomToken, sha256 } from "../common/ids";
import type { Database, Tx } from "../db/database";

const ROLE_ORDER = { OWNER: 0, ADMIN: 1, MANAGER: 2, EMPLOYEE: 3 } as const;

function toDto(m: Membership & { user: User }): MemberDto {
  return {
    id: m.id,
    userId: m.userId,
    fullName: m.user.fullName,
    email: m.user.email,
    role: m.role,
    status: m.status,
    title: m.title,
    departmentId: m.departmentId,
    invitedAt: m.invitedAt?.toISOString() ?? null,
    joinedAt: m.joinedAt?.toISOString() ?? null,
  };
}

/** Invite links look like `<tenantId>.<secret>`; only sha256(secret) is stored. */
function parseInviteToken(token: string) {
  const dot = token.indexOf(".");
  if (dot < 1 || token.length > 200) throw new AppError("INVITE_INVALID", "Invite link is invalid or expired");
  return { tenantId: token.slice(0, dot), hash: sha256(token.slice(dot + 1)) };
}

/** Memberships with their user accounts. */
async function withUsers(tx: Tx, rows: Membership[]): Promise<(Membership & { user: User })[]> {
  const users = new Map((await tx.user.find({ id: { $in: [...new Set(rows.map((m) => m.userId))] } })).map((u) => [u.id, u]));
  return rows.filter((m) => users.has(m.userId)).map((m) => ({ ...m, user: users.get(m.userId)! }));
}

const withUser = async (tx: Tx, m: Membership) => ({ ...m, user: await tx.user.get({ id: m.userId }) });

const inviteExpiry = (invitedAt: Date) => new Date(invitedAt.getTime() + config().INVITE_TTL_DAYS * 86_400_000);

export class MembersService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly tokens: TokensService,
    private readonly mail: MailService,
  ) {}

  async list(): Promise<MemberDto[]> {
    const { tenantId } = authedContext();
    const rows = await this.db.scoped(async (tx) =>
      // Explicit tenant filter: the Membership policy also exposes the caller's
      // memberships in *other* tenants (for the workspace switcher).
      withUsers(tx, await tx.membership.find({ tenantId })),
    );
    return rows
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.user.fullName.localeCompare(b.user.fullName))
      .map(toDto);
  }

  async invite(input: InviteInput): Promise<InviteCreatedResponse> {
    const ctx = authedContext();
    if (!assignableRoles(ctx.role).includes(input.role)) throw forbidden(`Cannot invite with role ${input.role}`);

    const secret = randomToken(24);
    const member = await this.db.scoped(async (tx) => {
      await this.assertDepartment(tx, ctx.tenantId, input.departmentId);
      const user = await tx.user.upsert({ email: input.email }, {}, { email: input.email, fullName: input.fullName ?? input.email.split("@")[0]! });
      const existing = await tx.membership.findOne({ tenantId: ctx.tenantId, userId: user.id });
      if (existing && existing.status !== "INVITED") {
        throw new AppError("CONFLICT", existing.status === "ACTIVE" ? "Already a member" : "Member is disabled — re-enable them instead");
      }
      if (!existing) await this.entitlements.assertSeatAvailable(tx, ctx.tenantId);

      const data = {
        role: input.role,
        departmentId: input.departmentId ?? null,
        title: input.title ?? null,
        inviteToken: sha256(secret),
        invitedAt: new Date(),
      };
      const saved = {
        ...(existing
          ? await tx.membership.update({ id: existing.id }, { $set: data })
          : await tx.membership.insertOne({ ...data, tenantId: ctx.tenantId, userId: user.id, status: "INVITED" })),
        user,
      };
      await this.audit.log(tx, {
        action: existing ? "member.reinvited" : "member.invited",
        entityType: "membership",
        entityId: saved.id,
        diff: { email: input.email, role: input.role },
      });
      const [tenant, inviter] = await Promise.all([
        tx.tenant.get({ id: ctx.tenantId }, { projection: { name: 1 } }),
        tx.user.get({ id: ctx.userId }, { projection: { fullName: 1 } }),
      ]);
      await this.mail.queue(tx, {
        tenantId: ctx.tenantId,
        to: input.email,
        locale: user.locale,
        template: "invite",
        vars: { company: tenant.name, inviter: inviter.fullName, link: `${config().WEB_ORIGIN}/invite/${ctx.tenantId}.${secret}`, days: config().INVITE_TTL_DAYS },
      });
      return saved;
    });

    return {
      member: toDto(member),
      invitePath: `/invite/${ctx.tenantId}.${secret}`,
      expiresAt: inviteExpiry(member.invitedAt!).toISOString(),
      emailDelivery: this.mail.configured ? "queued" : "not_configured",
    };
  }

  async update(id: string, input: UpdateMemberInput): Promise<MemberDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const target = await tx.membership.findOne({ id, tenantId: ctx.tenantId });
      if (!target) throw notFound("Member");

      const changesAccess = input.role !== undefined || input.status !== undefined;
      if (changesAccess && target.id === ctx.membershipId) throw forbidden("You cannot change your own role or status");
      if (target.role === "OWNER" && ctx.role !== "OWNER") throw forbidden("Only an owner can modify another owner");
      if (input.role && input.role !== target.role && !assignableRoles(ctx.role).includes(input.role)) {
        throw forbidden(`Cannot assign role ${input.role}`);
      }

      const losesOwner = target.role === "OWNER" && ((input.role && input.role !== "OWNER") || input.status === "DISABLED");
      if (losesOwner) {
        // Writing the tenant document serialises concurrent owner changes: MongoDB aborts
        // one of two transactions touching it, and the retry sees the committed state
        await tx.tenant.update({ id: ctx.tenantId }, { $inc: { lockVersion: 1 } });
        const owners = await tx.membership.count({ tenantId: ctx.tenantId, role: "OWNER", status: "ACTIVE" });
        if (owners <= 1) throw new AppError("LAST_OWNER", "The company must keep at least one active owner");
      }

      if (input.status === "ACTIVE" && target.status !== "ACTIVE") {
        // Only re-enabling is allowed here; invited members activate by accepting the invite
        if (target.status !== "DISABLED") throw new AppError("CONFLICT", "Invite has not been accepted yet");
        await this.entitlements.assertSeatAvailable(tx, ctx.tenantId);
      }
      if (input.departmentId !== undefined) await this.assertDepartment(tx, ctx.tenantId, input.departmentId);

      const updated = await tx.membership.update(
        { id: target.id },
        {
          $set: {
            role: input.role,
            status: input.status,
            departmentId: input.departmentId,
            title: input.title,
            // Disabling a pending invite also kills its link
            ...(input.status === "DISABLED" ? { inviteToken: null } : {}),
          },
        },
      );

      if (input.status === "DISABLED") {
        await tx.session.updateMany({ userId: target.userId, tenantId: ctx.tenantId, revokedAt: null }, { $set: { revokedAt: new Date() } });
      }

      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ["role", "status", "departmentId", "title"] as const) {
        if (input[key] !== undefined && input[key] !== target[key]) diff[key] = { from: target[key], to: input[key] };
      }
      if (Object.keys(diff).length) {
        await this.audit.log(tx, { action: "member.updated", entityType: "membership", entityId: target.id, diff: diff as never });
      }
      return toDto(await withUser(tx, updated));
    });
  }

  async previewInvite(token: string): Promise<InvitePreview> {
    const { tenantId, hash } = parseInviteToken(token);
    return this.db.scoped(
      async (tx) => {
        const m = await this.findInvite(tx, tenantId, hash);
        const tenant = await tx.tenant.get({ id: tenantId });
        return {
          tenantName: tenant.name,
          email: m.user.email,
          fullName: m.user.fullName,
          role: m.role,
          needsAccount: !m.user.passwordHash,
          expiresAt: inviteExpiry(m.invitedAt!).toISOString(),
        };
      },
      { tenantId },
    );
  }

  async acceptInvite(token: string, input: AcceptInviteInput): Promise<AuthTokens> {
    const { tenantId, hash } = parseInviteToken(token);
    const passwordHash = await hashPassword(input.password);
    return this.db.scoped(
      async (tx) => {
        const m = await this.findInvite(tx, tenantId, hash);
        if (m.user.passwordHash) {
          // Existing account: joining another company requires proving ownership of it
          if (!(await verifyPassword(m.user.passwordHash, input.password))) {
            throw new AppError("INVALID_CREDENTIALS", "Password is incorrect");
          }
        } else {
          await tx.user.update({ id: m.userId }, { $set: { passwordHash, fullName: input.fullName ?? m.user.fullName, emailVerified: new Date() } });
        }
        await tx.membership.update({ id: m.id }, { $set: { status: "ACTIVE", joinedAt: new Date(), inviteToken: null } });
        await this.audit.log(tx, { action: "member.joined", entityType: "membership", entityId: m.id, tenantId, actorId: m.userId });
        return this.tokens.issue(tx, m.userId, tenantId);
      },
      { tenantId, userId: undefined },
    );
  }

  private async findInvite(tx: Tx, tenantId: string, hash: string) {
    const m = await tx.membership.findOne({ tenantId, inviteToken: hash, status: "INVITED" });
    if (!m || !m.invitedAt || inviteExpiry(m.invitedAt) < new Date()) {
      throw new AppError("INVITE_INVALID", "Invite link is invalid or expired");
    }
    return withUser(tx, m);
  }

  private async assertDepartment(tx: Tx, tenantId: string, departmentId: string | null | undefined) {
    if (!departmentId) return;
    const exists = await tx.department.count({ id: departmentId, tenantId });
    if (!exists) throw new AppError("VALIDATION_FAILED", "Unknown department", { departmentId: ["Unknown department"] });
  }
}
