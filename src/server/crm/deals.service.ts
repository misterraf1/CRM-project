import { AutomationRunner } from "../automations/automation.runner";
import type { Deal } from "../db/models";
import type {
  ActivityDto,
  DealCreateInput,
  DealDto,
  DealListQuery,
  DealMoveInput,
  DealUpdateInput,
  ForecastDto,
  PipelineDto,
  StageKind,
} from "@/shared";
import { AuditService } from "../audit/audit.service";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { startOfMonth } from "../common/time";
import type { Database, Tx } from "../db/database";
import { and, contains } from "../db/query";
import { ActivityService, TIMELINE_ORDER } from "./activity.service";
import { memberRefs, ownerScope, resolveOwner } from "./scope";

type DealRow = Deal & { contact: { id: string; name: string } | null };

const POSITION_STEP = 1024;
/** Closed deals stay on the board this long, then live only in reports and contact history. */
const CLOSED_VISIBLE_DAYS = 30;

export function dealToDto(d: DealRow, refs: Map<string, { id: string; name: string }>): DealDto {
  const owner = d.ownerId ? refs.get(d.ownerId) : undefined;
  return {
    id: d.id,
    title: d.title,
    amount: d.amount,
    currency: d.currency,
    pipelineId: d.pipelineId,
    stageId: d.stageId,
    position: d.position,
    contact: d.contact,
    owner: owner ? { id: owner.id, name: owner.name } : null,
    expectedClose: d.expectedClose?.toISOString() ?? null,
    closedAt: d.closedAt?.toISOString() ?? null,
    lostReason: d.lostReason,
    createdAt: d.createdAt.toISOString(),
  };
}

/** Ids of the tenant's pipeline stages of one kind (deals filter on these). */
export async function stageIds(tx: Tx, tenantId: string, kind: StageKind) {
  return (await tx.pipelineStage.find({ tenantId, kind }, { projection: { id: 1 } })).map((s) => s.id);
}

/** Deals with their contact's id and name (soft-deleted contacts still show by name). */
export async function withContacts(tx: Tx, tenantId: string, deals: Deal[]): Promise<DealRow[]> {
  const ids = [...new Set(deals.map((d) => d.contactId).filter((id): id is string => !!id))];
  const contacts = ids.length ? await tx.contact.find({ tenantId, id: { $in: ids } }, { projection: { id: 1, name: 1 } }) : [];
  const byId = new Map(contacts.map((c) => [c.id, { id: c.id, name: c.name }]));
  return deals.map((d) => ({ ...d, contact: (d.contactId && byId.get(d.contactId)) || null }));
}

export class DealsService {
  constructor(
    private readonly db: Database,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly automations: AutomationRunner,
  ) {}

  async pipelines(): Promise<PipelineDto[]> {
    const { tenantId } = authedContext();
    const [rows, stages] = await this.db.scoped((tx) =>
      Promise.all([tx.pipeline.find({ tenantId }, { sort: { isDefault: -1, name: 1 } }), tx.pipelineStage.find({ tenantId }, { sort: { order: 1 } })]),
    );
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      stages: stages
        .filter((s) => s.pipelineId === p.id)
        .map((s) => ({ id: s.id, name: s.name, order: s.order, probability: s.probability, kind: s.kind as StageKind })),
    }));
  }

  async list(query: DealListQuery): Promise<DealDto[]> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const pipeline = await this.resolvePipeline(tx, ctx, query.pipelineId);
      const { where: scoped } = await ownerScope(tx, ctx, "contacts.view_all");
      const recent = new Date(Date.now() - CLOSED_VISIBLE_DAYS * 86_400_000);
      const q = query.q?.trim();
      const matchingContacts = q ? (await tx.contact.find({ tenantId: ctx.tenantId, name: contains(q) }, { projection: { id: 1 } })).map((c) => c.id) : [];
      const rows = await withContacts(
        tx,
        ctx.tenantId,
        await tx.deal.find(
          and(
            { tenantId: ctx.tenantId, pipelineId: pipeline.id },
            scoped,
            { $or: [{ closedAt: null }, { closedAt: { $gte: recent } }] },
            query.ownerId ? { ownerId: query.ownerId } : {},
            q ? { $or: [{ title: contains(q) }, { contactId: { $in: matchingContacts } }] } : {},
          ),
          { sort: { position: 1, createdAt: 1 } },
        ),
      );
      const refs = await memberRefs(tx, ctx.tenantId, rows.map((d) => d.ownerId));
      return rows.map((d) => dealToDto(d, refs));
    });
  }

  async get(id: string): Promise<DealDto & { activities: ActivityDto[] }> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const deal = await this.findVisible(tx, ctx, id);
      const rows = await tx.activity.find({ tenantId: ctx.tenantId, dealId: id }, { sort: TIMELINE_ORDER, limit: 100 });
      const refs = await memberRefs(tx, ctx.tenantId, [deal.ownerId]);
      return { ...dealToDto(deal, refs), activities: await this.activity.toDtos(tx, ctx.tenantId, rows) };
    });
  }

  async create(input: DealCreateInput): Promise<DealDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const pipeline = await this.resolvePipeline(tx, ctx, input.pipelineId);
      const stage = input.stageId ? pipeline.stages.find((s) => s.id === input.stageId) : pipeline.stages.find((s) => s.kind === "open");
      if (!stage) throw new AppError("VALIDATION_FAILED", "Unknown stage", { stageId: ["Unknown stage"] });
      if (stage.kind !== "open") throw new AppError("VALIDATION_FAILED", "New deals start in an open stage", { stageId: ["Closed stage"] });
      const contact = input.contactId ? await this.visibleContact(tx, ctx, input.contactId) : null;
      const ownerId = await resolveOwner(tx, ctx, input.ownerId, ctx.membershipId);

      const created = await tx.deal.insertOne({
        tenantId: ctx.tenantId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: input.title,
        amount: input.amount,
        contactId: contact?.id ?? null,
        ownerId,
        expectedClose: input.expectedClose ?? null,
        position: await this.nextPosition(tx, stage.id),
      });
      const deal = { ...created, contact };
      await this.activity.record(tx, {
        type: "deal_created",
        dealId: deal.id,
        contactId: deal.contactId,
        payload: { dealTitle: deal.title, amount: deal.amount, stage: stage.name, contactName: contact?.name ?? null },
      });
      await this.automations.enqueue(tx, ctx.tenantId, "deal.created", { dealId: deal.id });
      return dealToDto(deal, await memberRefs(tx, ctx.tenantId, [ownerId]));
    });
  }

  async update(id: string, input: DealUpdateInput): Promise<DealDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      await this.findVisible(tx, ctx, id);
      const contactId = input.contactId ? (await this.visibleContact(tx, ctx, input.contactId)).id : input.contactId;
      const ownerId = input.ownerId !== undefined ? await resolveOwner(tx, ctx, input.ownerId, null) : undefined;
      const [deal] = await withContacts(
        tx,
        ctx.tenantId,
        [await tx.deal.update({ id }, { $set: { title: input.title, amount: input.amount, contactId, ownerId, expectedClose: input.expectedClose } })],
      );
      return dealToDto(deal!, await memberRefs(tx, ctx.tenantId, [deal!.ownerId]));
    });
  }

  /**
   * Stage change (Kanban drag). Entering won/lost closes the deal; dragging it back
   * to an open stage reopens it. A won deal turns its contact into a customer.
   */
  async move(id: string, input: DealMoveInput): Promise<DealDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const deal = await this.findVisible(tx, ctx, id);
      const stages = await tx.pipelineStage.find({ tenantId: ctx.tenantId, pipelineId: deal.pipelineId });
      const from = stages.find((s) => s.id === deal.stageId)!;
      const to = stages.find((s) => s.id === input.stageId);
      if (!to) throw new AppError("VALIDATION_FAILED", "Stage belongs to another pipeline", { stageId: ["Unknown stage"] });
      if (to.kind === "lost" && !input.lostReason && from.kind !== "lost") {
        throw new AppError("VALIDATION_FAILED", "A lost deal needs a reason", { lostReason: ["Required"] });
      }

      const closing = to.kind !== "open";
      const changed = await tx.deal.update(
        { id },
        {
          $set: {
            stageId: to.id,
            position: input.position ?? (to.id === from.id ? deal.position : await this.nextPosition(tx, to.id)),
            closedAt: closing ? (from.kind === to.kind ? deal.closedAt : new Date()) : null,
            lostReason: to.kind === "lost" ? (input.lostReason ?? deal.lostReason) : null,
          },
        },
      );
      const updated = { ...changed, contact: deal.contact };

      if (to.id !== from.id) {
        const base = { dealId: id, contactId: deal.contactId };
        await this.activity.record(tx, { ...base, type: "deal_stage", payload: { dealTitle: deal.title, from: from.name, to: to.name } });
        if (to.kind === "won") {
          await this.activity.record(tx, { ...base, type: "deal_won", payload: { dealTitle: deal.title, amount: deal.amount } });
          if (deal.contactId) await this.promoteToCustomer(tx, deal.contactId);
        }
        if (to.kind === "lost") {
          await this.activity.record(tx, { ...base, type: "deal_lost", payload: { dealTitle: deal.title, amount: deal.amount, reason: updated.lostReason } });
        }
        await this.automations.enqueue(tx, ctx.tenantId, "deal.stage_changed", { dealId: id, fromStageId: from.id, toStageId: to.id });
      }
      return dealToDto(updated, await memberRefs(tx, ctx.tenantId, [updated.ownerId]));
    });
  }

  async remove(id: string) {
    const ctx = authedContext();
    await this.db.scoped(async (tx) => {
      const deal = await this.findVisible(tx, ctx, id);
      await tx.deal.delete({ id });
      await this.audit.log(tx, { action: "deal.deleted", entityType: "deal", entityId: id, diff: { title: deal.title, amount: deal.amount } });
    });
  }

  async forecast(pipelineId?: string): Promise<ForecastDto> {
    const ctx = authedContext();
    return this.db.scoped(async (tx) => {
      const pipeline = await this.resolvePipeline(tx, ctx, pipelineId);
      const tenant = await tx.tenant.get({ id: ctx.tenantId }, { projection: { timezone: 1, currency: 1 } });
      const { where: scoped } = await ownerScope(tx, ctx, "contacts.view_all");
      const monthStart = startOfMonth(new Date(), tenant.timezone);
      const deals = await tx.deal.find(
        and({ tenantId: ctx.tenantId, pipelineId: pipeline.id }, scoped, { $or: [{ closedAt: null }, { closedAt: { $gte: monthStart } }] }),
        { projection: { amount: 1, stageId: 1, lostReason: 1 } },
      );
      const stageById = new Map(pipeline.stages.map((s) => [s.id, s]));
      const out: ForecastDto = {
        currency: tenant.currency,
        open: { count: 0, amount: 0 },
        weighted: 0,
        wonThisMonth: { count: 0, amount: 0 },
        lostThisMonth: { count: 0, amount: 0, reasons: [] },
      };
      const reasons = new Map<string, number>();
      for (const d of deals) {
        const stage = stageById.get(d.stageId)!;
        if (stage.kind === "open") {
          out.open.count++;
          out.open.amount += d.amount;
          out.weighted += Math.round((d.amount * stage.probability) / 100);
        } else if (stage.kind === "won") {
          out.wonThisMonth.count++;
          out.wonThisMonth.amount += d.amount;
        } else {
          out.lostThisMonth.count++;
          out.lostThisMonth.amount += d.amount;
          const r = d.lostReason ?? "other";
          reasons.set(r, (reasons.get(r) ?? 0) + 1);
        }
      }
      out.lostThisMonth.reasons = [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
      return out;
    });
  }

  private async promoteToCustomer(tx: Tx, contactId: string) {
    const contact = await tx.contact.findOne({ id: contactId });
    if (!contact || contact.deletedAt || contact.stage === "CUSTOMER") return;
    await tx.contact.update({ id: contactId }, { $set: { stage: "CUSTOMER" } });
    await this.activity.record(tx, {
      type: "contact_stage",
      contactId,
      payload: { contactName: contact.name, from: contact.stage, to: "CUSTOMER", automatic: true },
    });
  }

  private async findVisible(tx: Tx, ctx: AuthedContext, id: string) {
    const { where } = await ownerScope(tx, ctx, "contacts.view_all");
    const deal = await tx.deal.findOne(and({ id, tenantId: ctx.tenantId }, where));
    if (!deal) throw notFound("Deal");
    return (await withContacts(tx, ctx.tenantId, [deal]))[0]!;
  }

  private async visibleContact(tx: Tx, ctx: AuthedContext, contactId: string) {
    const { where } = await ownerScope(tx, ctx, "contacts.view_all");
    const contact = await tx.contact.findOne(and({ id: contactId, tenantId: ctx.tenantId, deletedAt: null }, where), { projection: { id: 1, name: 1 } });
    if (!contact) throw new AppError("VALIDATION_FAILED", "Unknown contact", { contactId: ["Unknown contact"] });
    return { id: contact.id, name: contact.name };
  }

  private async resolvePipeline(tx: Tx, ctx: AuthedContext, pipelineId?: string) {
    const pipeline = await tx.pipeline.findOne(pipelineId ? { id: pipelineId, tenantId: ctx.tenantId } : { tenantId: ctx.tenantId, isDefault: true });
    if (!pipeline) throw notFound("Pipeline");
    return { ...pipeline, stages: await tx.pipelineStage.find({ tenantId: ctx.tenantId, pipelineId: pipeline.id }, { sort: { order: 1 } }) };
  }

  private async nextPosition(tx: Tx, stageId: string) {
    const last = await tx.deal.findOne({ stageId }, { sort: { position: -1 }, projection: { position: 1 } });
    return (last?.position ?? 0) + POSITION_STEP;
  }
}
