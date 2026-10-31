import type { AutomationAction, AutomationConditions, AutomationRuleDto, AutomationRuleInput, AutomationRunDto, AutomationTrigger } from "@/shared";
import type { AutomationRule } from "../db/models";
import { AuditService } from "../audit/audit.service";
import { EntitlementsService } from "../billing/entitlements.service";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { memberRefs } from "../crm/scope";
import type { Database, Tx } from "../db/database";

const MAX_RULES = 50;

export class AutomationsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private dto(r: AutomationRule, names: Map<string, { name: string }>): AutomationRuleDto {
    return {
      id: r.id,
      name: r.name,
      trigger: r.trigger as AutomationTrigger,
      conditions: r.conditions as AutomationConditions,
      actions: r.actions as AutomationAction[],
      enabled: r.enabled,
      runCount: r.runCount,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      lastError: r.lastError,
      createdBy: names.get(r.createdById)?.name ?? "—",
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** Members named in actions and the stage in conditions must belong to this company. */
  private async validate(tx: Tx, tenantId: string, input: Partial<AutomationRuleInput>) {
    const ids = new Set<string>();
    for (const a of input.actions ?? []) {
      if (a.type === "create_task" && a.assignee !== "owner") ids.add(a.assignee);
      if (a.type === "notify" && a.recipient !== "owner" && a.recipient !== "managers") ids.add(a.recipient);
      if (a.type === "assign") a.memberIds.forEach((id) => ids.add(id));
    }
    if (ids.size) {
      const found = await tx.membership.count({ tenantId, id: { $in: [...ids] }, status: "ACTIVE" });
      if (found !== ids.size) throw new AppError("VALIDATION_FAILED", "Unknown member in actions", { actions: ["Unknown member"] });
    }
    const stageId = input.conditions?.stageId;
    if (stageId && !(await tx.pipelineStage.count({ tenantId, id: stageId }))) {
      throw new AppError("VALIDATION_FAILED", "Unknown stage", { conditions: ["Unknown stage"] });
    }
    // Automatic moves go to open or won stages (a lost deal needs a person's reason)
    for (const a of input.actions ?? []) {
      if (a.type === "move_stage" && !(await tx.pipelineStage.count({ tenantId, id: a.stageId, kind: { $ne: "lost" } }))) {
        throw new AppError("VALIDATION_FAILED", "Unknown stage", { actions: ["Unknown stage"] });
      }
    }
  }

  async list(): Promise<AutomationRuleDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const rules = await tx.automationRule.find({ tenantId: ctx.tenantId }, { sort: { createdAt: 1 } });
      const names = await memberRefs(tx, ctx.tenantId, rules.map((r) => r.createdById));
      return rules.map((r) => this.dto(r, names));
    });
  }

  async create(input: AutomationRuleInput): Promise<AutomationRuleDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      if ((await tx.automationRule.count({ tenantId: ctx.tenantId })) >= MAX_RULES) {
        throw new AppError("CONFLICT", `At most ${MAX_RULES} automations per company`);
      }
      await this.entitlements.assertCapacity(tx, ctx.tenantId, "automations");
      await this.validate(tx, ctx.tenantId, input);
      const rule = await tx.automationRule.insertOne({
        tenantId: ctx.tenantId,
        name: input.name,
        trigger: input.trigger,
        conditions: input.conditions as AutomationRule["conditions"],
        actions: input.actions as unknown as AutomationRule["actions"],
        enabled: input.enabled,
        createdById: ctx.membershipId,
      });
      await this.audit.log(tx, { action: "automation.created", entityType: "automation", entityId: rule.id, diff: { name: rule.name, trigger: rule.trigger } });
      return this.dto(rule, await memberRefs(tx, ctx.tenantId, [rule.createdById]));
    });
  }

  async update(id: string, input: Partial<AutomationRuleInput>): Promise<AutomationRuleDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const existing = await tx.automationRule.findOne({ id, tenantId: ctx.tenantId });
      if (!existing) throw notFound("Automation");
      await this.validate(tx, ctx.tenantId, input);
      const rule = await tx.automationRule.update(
        { id },
        {
          $set: {
            name: input.name,
            trigger: input.trigger,
            conditions: input.conditions,
            actions: input.actions,
            enabled: input.enabled,
            // A fixed rule starts clean
            ...(input.actions || input.conditions || input.trigger ? { lastError: null } : {}),
          },
        },
      );
      await this.audit.log(tx, { action: "automation.updated", entityType: "automation", entityId: id, diff: Object.keys(input) });
      return this.dto(rule, await memberRefs(tx, ctx.tenantId, [rule.createdById]));
    });
  }

  async remove(id: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const existing = await tx.automationRule.findOne({ id, tenantId: ctx.tenantId });
      if (!existing) throw notFound("Automation");
      await tx.automationRun.deleteMany({ tenantId: ctx.tenantId, ruleId: id });
      await tx.automationRule.delete({ id });
      await this.audit.log(tx, { action: "automation.deleted", entityType: "automation", entityId: id, diff: { name: existing.name } });
    });
  }

  async runs(id: string): Promise<AutomationRunDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      if (!(await tx.automationRule.count({ id, tenantId: ctx.tenantId }))) throw notFound("Automation");
      const rows = await tx.automationRun.find({ tenantId: ctx.tenantId, ruleId: id }, { sort: { createdAt: -1 }, limit: 50 });
      return rows.map((r) => ({ id: r.id, status: r.status as AutomationRunDto["status"], detail: r.detail, createdAt: r.createdAt.toISOString() }));
    });
  }
}
