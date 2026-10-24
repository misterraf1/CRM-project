import { Injectable } from "@nestjs/common";
import { AutomationRunner } from "../automations/automation.runner";
import type { Deal, Prisma } from "@prisma/client";
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
} from "@axis/shared";
import { AuditService } from "../audit/audit.service";
import { authedContext, type AuthedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import { startOfMonth } from "../common/time";
import { PrismaService, type Tx } from "../prisma/prisma.service";
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

const WITH_CONTACT = { contact: { select: { id: true, name: true } } } as const;

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly automations: AutomationRunner,
  ) {}

  async pipelines(): Promise<PipelineDto[]> {
    const { tenantId } = authedContext();
    const rows = await this.prisma.scoped((tx) =>
      tx.pipeline.findMany({
        where: { tenantId },
        include: { stages: { orderBy: { order: "asc" } } },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      }),
    );
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.isDefault,
      stages: p.stages.map((s) => ({ id: s.id, name: s.name, order: s.order, probability: s.probability, kind: s.kind as StageKind })),
    }));
  }

  async list(query: DealListQuery): Promise<DealDto[]> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const pipeline = await this.resolvePipeline(tx, ctx, query.pipelineId);
      const { where: scoped } = await ownerScope(tx, ctx, "contacts.view_all");
      const recent = new Date(Date.now() - CLOSED_VISIBLE_DAYS * 86_400_000);
      const q = query.q?.trim();
      const rows = await tx.deal.findMany({
        where: {
          AND: [
            { tenantId: ctx.tenantId, pipelineId: pipeline.id },
            scoped,
            { OR: [{ closedAt: null }, { closedAt: { gte: recent } }] },
            query.ownerId ? { ownerId: query.ownerId } : {},
            q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { contact: { name: { contains: q, mode: "insensitive" } } }] } : {},
          ],
        },
        include: WITH_CONTACT,
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      });
      const refs = await memberRefs(tx, ctx.tenantId, rows.map((d) => d.ownerId));
      return rows.map((d) => dealToDto(d, refs));
    });
  }

  async get(id: string): Promise<DealDto & { activities: ActivityDto[] }> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const deal = await this.findVisible(tx, ctx, id);
      const rows = await tx.activity.findMany({ where: { tenantId: ctx.tenantId, dealId: id }, orderBy: TIMELINE_ORDER, take: 100 });
      const refs = await memberRefs(tx, ctx.tenantId, [deal.ownerId]);
      return { ...dealToDto(deal, refs), activities: await this.activity.toDtos(tx, ctx.tenantId, rows) };
    });
  }

  async create(input: DealCreateInput): Promise<DealDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const pipeline = await this.resolvePipeline(tx, ctx, input.pipelineId);
      const stage = input.stageId ? pipeline.stages.find((s) => s.id === input.stageId) : pipeline.stages.find((s) => s.kind === "open");
      if (!stage) throw new AppError("VALIDATION_FAILED", "Unknown stage", { stageId: ["Unknown stage"] });
      if (stage.kind !== "open") throw new AppError("VALIDATION_FAILED", "New deals start in an open stage", { stageId: ["Closed stage"] });
      const contact = input.contactId ? await this.visibleContact(tx, ctx, input.contactId) : null;
      const ownerId = await resolveOwner(tx, ctx, input.ownerId, ctx.membershipId);

      const deal = await tx.deal.create({
        data: {
          tenantId: ctx.tenantId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          title: input.title,
          amount: input.amount,
          contactId: contact?.id ?? null,
          ownerId,
          expectedClose: input.expectedClose ?? null,
          position: await this.nextPosition(tx, stage.id),
        },
        include: WITH_CONTACT,
      });
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
    return this.prisma.scoped(async (tx) => {
      await this.findVisible(tx, ctx, id);
      const contactId = input.contactId ? (await this.visibleContact(tx, ctx, input.contactId)).id : input.contactId;
      const ownerId = input.ownerId !== undefined ? await resolveOwner(tx, ctx, input.ownerId, null) : undefined;
      const deal = await tx.deal.update({
        where: { id },
        data: { title: input.title, amount: input.amount, contactId, ownerId, expectedClose: input.expectedClose },
        include: WITH_CONTACT,
      });
      return dealToDto(deal, await memberRefs(tx, ctx.tenantId, [deal.ownerId]));
    });
  }

  /**
   * Stage change (Kanban drag). Entering won/lost closes the deal; dragging it back
   * to an open stage reopens it. A won deal turns its contact into a customer.
   */
  async move(id: string, input: DealMoveInput): Promise<DealDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const deal = await this.findVisible(tx, ctx, id);
      const stages = await tx.pipelineStage.findMany({ where: { tenantId: ctx.tenantId, pipelineId: deal.pipelineId } });
      const from = stages.find((s) => s.id === deal.stageId)!;
      const to = stages.find((s) => s.id === input.stageId);
      if (!to) throw new AppError("VALIDATION_FAILED", "Stage belongs to another pipeline", { stageId: ["Unknown stage"] });
      if (to.kind === "lost" && !input.lostReason && from.kind !== "lost") {
        throw new AppError("VALIDATION_FAILED", "A lost deal needs a reason", { lostReason: ["Required"] });
      }

      const closing = to.kind !== "open";
      const updated = await tx.deal.update({
        where: { id },
        data: {
          stageId: to.id,
          position: input.position ?? (to.id === from.id ? deal.position : await this.nextPosition(tx, to.id)),
          closedAt: closing ? (from.kind === to.kind ? deal.closedAt : new Date()) : null,
          lostReason: to.kind === "lost" ? (input.lostReason ?? deal.lostReason) : null,
        },
        include: WITH_CONTACT,
      });

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
    await this.prisma.scoped(async (tx) => {
      const deal = await this.findVisible(tx, ctx, id);
      await tx.deal.delete({ where: { id } });
      await this.audit.log(tx, { action: "deal.deleted", entityType: "deal", entityId: id, diff: { title: deal.title, amount: deal.amount } });
    });
  }

  async forecast(pipelineId?: string): Promise<ForecastDto> {
    const ctx = authedContext();
    return this.prisma.scoped(async (tx) => {
      const pipeline = await this.resolvePipeline(tx, ctx, pipelineId);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true, currency: true } });
      const { where: scoped } = await ownerScope(tx, ctx, "contacts.view_all");
      const monthStart = startOfMonth(new Date(), tenant.timezone);
      const deals = await tx.deal.findMany({
        where: {
          AND: [
            { tenantId: ctx.tenantId, pipelineId: pipeline.id },
            scoped,
            { OR: [{ closedAt: null }, { closedAt: { gte: monthStart } }] },
          ],
        },
        select: { amount: true, stageId: true, lostReason: true },
      });
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
    const contact = await tx.contact.findUnique({ where: { id: contactId } });
    if (!contact || contact.deletedAt || contact.stage === "CUSTOMER") return;
    await tx.contact.update({ where: { id: contactId }, data: { stage: "CUSTOMER" } });
    await this.activity.record(tx, {
      type: "contact_stage",
      contactId,
      payload: { contactName: contact.name, from: contact.stage, to: "CUSTOMER", automatic: true },
    });
  }

  private async findVisible(tx: Tx, ctx: AuthedContext, id: string) {
    const { where } = await ownerScope(tx, ctx, "contacts.view_all");
    const deal = await tx.deal.findFirst({ where: { AND: [{ id, tenantId: ctx.tenantId }, where] }, include: WITH_CONTACT });
    if (!deal) throw notFound("Deal");
    return deal;
  }

  private async visibleContact(tx: Tx, ctx: AuthedContext, contactId: string) {
    const { where } = await ownerScope(tx, ctx, "contacts.view_all");
    const contact = await tx.contact.findFirst({
      where: { AND: [{ id: contactId, tenantId: ctx.tenantId, deletedAt: null }, where] },
      select: { id: true, name: true },
    });
    if (!contact) throw new AppError("VALIDATION_FAILED", "Unknown contact", { contactId: ["Unknown contact"] });
    return contact;
  }

  private async resolvePipeline(tx: Tx, ctx: AuthedContext, pipelineId?: string) {
    const where: Prisma.PipelineWhereInput = pipelineId ? { id: pipelineId, tenantId: ctx.tenantId } : { tenantId: ctx.tenantId, isDefault: true };
    const pipeline = await tx.pipeline.findFirst({ where, include: { stages: { orderBy: { order: "asc" } } } });
    if (!pipeline) throw notFound("Pipeline");
    return pipeline;
  }

  private async nextPosition(tx: Tx, stageId: string) {
    const last = await tx.deal.aggregate({ where: { stageId }, _max: { position: true } });
    return (last._max.position ?? 0) + POSITION_STEP;
  }
}
