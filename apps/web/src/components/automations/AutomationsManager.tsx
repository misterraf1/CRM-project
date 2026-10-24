"use client";

import {
  AUTOMATION_TRIGGERS,
  CONTACT_SOURCES,
  type AutomationAction,
  type AutomationRuleDto,
  type AutomationRuleInput,
  type AutomationRunDto,
  type AutomationTrigger,
  type StageDto,
} from "@axis/shared";
import clsx from "clsx";
import { Pencil, Plus, Trash2, X, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { formatDateTime, moneyInputValue, parseMoneyInput } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { errorMessage } from "@/lib/i18n/errors";
import { interpolate } from "@/lib/i18n/locales";

interface Member {
  id: string;
  name: string;
}

type Draft = AutomationRuleInput & { id?: string };

const CHANNELS = ["WHATSAPP", "INSTAGRAM", "MESSENGER", "WEBCHAT"] as const;
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const DEAL_TRIGGERS = new Set<AutomationTrigger>(["deal.created", "deal.stage_changed"]);

const blankAction = (type: AutomationAction["type"], members: Member[]): AutomationAction =>
  type === "create_task"
    ? { type, title: "", dueInDays: 1, assignee: "owner", priority: "MEDIUM" }
    : type === "notify"
      ? { type, recipient: "owner", message: "" }
      : { type, memberIds: members.slice(0, 1).map((m) => m.id) };

/** List of rules with on/off, run history, and a form to build or edit a rule. */
export function AutomationsManager({ rules, members, stages }: { rules: AutomationRuleDto[]; members: Member[]; stages: StageDto[] }) {
  const { t, locale } = useI18n();
  const k = t.automations;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [runs, setRuns] = useState<{ id: string; items: AutomationRunDto[] } | null>(null);
  // On/off switches flip at once; the server state replaces them on refresh
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  useEffect(() => setEnabled({}), [rules]);

  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? "—";
  const won = stages.find((s) => s.kind === "won");

  const templates: { key: keyof typeof k.examples; draft: Draft }[] = [
    {
      key: "roundRobin",
      draft: { name: k.examples.roundRobin, trigger: "contact.created", conditions: { source: "instagram" }, enabled: true, actions: [{ type: "assign", memberIds: members.map((m) => m.id) }] },
    },
    {
      key: "wonFollowUp",
      draft: {
        name: k.examples.wonFollowUp,
        trigger: "deal.stage_changed",
        conditions: won ? { stageId: won.id } : {},
        enabled: true,
        actions: [
          { type: "create_task", title: k.exampleTexts.thanks, dueInDays: 1, assignee: "owner", priority: "HIGH" },
          { type: "notify", recipient: "managers", message: k.exampleTexts.won },
        ],
      },
    },
    {
      key: "overdueAlert",
      draft: { name: k.examples.overdueAlert, trigger: "task.overdue", conditions: {}, enabled: true, actions: [{ type: "notify", recipient: "managers", message: k.exampleTexts.overdue }] },
    },
    {
      key: "newChat",
      draft: { name: k.examples.newChat, trigger: "conversation.created", conditions: { channelType: "WHATSAPP" }, enabled: true, actions: [{ type: "assign", memberIds: members.slice(0, 1).map((m) => m.id) }] },
    },
  ];

  const run = (fn: () => ReturnType<typeof api>, onOk?: () => void, onFail?: () => void) =>
    startTransition(async () => {
      setError(undefined);
      const res = await fn();
      if (!res.ok) {
        onFail?.();
        return setError(errorMessage(t, res.code, res.details));
      }
      onOk?.();
      router.refresh();
    });

  async function showRuns(id: string) {
    if (runs?.id === id) return setRuns(null);
    const res = await api<AutomationRunDto[]>(`/automations/${id}/runs`);
    if (res.ok) setRuns({ id, items: res.data });
    else setError(errorMessage(t, res.code));
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const { id, ...body } = draft;
    run(() => (id ? api(`/automations/${id}`, "PATCH", body) : api("/automations", "POST", body)), () => setDraft(null));
  }

  const describeAction = (a: AutomationAction) =>
    a.type === "create_task"
      ? `${k.actionTypes.create_task}: «${a.title}»`
      : a.type === "notify"
        ? `${k.actionTypes.notify}: «${a.message}»`
        : `${k.actionTypes.assign}: ${a.memberIds.map(memberName).join(", ")}`;

  const describeConditions = (r: AutomationRuleDto) =>
    [
      r.conditions.stageId && `${k.stage}: ${stages.find((s) => s.id === r.conditions.stageId)?.name ?? "—"}`,
      r.conditions.minAmount !== undefined && `≥ ${moneyInputValue(r.conditions.minAmount)} ₼`,
      r.conditions.source && `${k.source}: ${t.crm.sources[r.conditions.source]}`,
      r.conditions.channelType && `${k.channel}: ${t.channels.types[r.conditions.channelType]}`,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="space-y-5" aria-busy={pending}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{k.title}</h1>
          <p className="mt-0.5 text-sm text-fg-muted">{k.subtitle}</p>
        </div>
        {!draft && (
          <button type="button" onClick={() => setDraft({ name: "", trigger: "contact.created", conditions: {}, actions: [blankAction("notify", members)], enabled: true })} className="btn-primary">
            <Plus className="h-4 w-4" aria-hidden />
            {k.new}
          </button>
        )}
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {!draft && (
        <section>
          <h2 className="mb-2 text-xs font-medium text-fg-muted">{k.templates}</h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {templates.map((tpl) => (
              <button key={tpl.key} type="button" onClick={() => setDraft(tpl.draft)} className="card flex items-start gap-2 p-3 text-left text-sm hover:border-accent/50">
                <Zap className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                {k.examples[tpl.key]}
              </button>
            ))}
          </div>
        </section>
      )}

      {draft && <RuleEditor draft={draft} setDraft={setDraft} members={members} stages={stages} pending={pending} onSubmit={save} />}

      {rules.length === 0 && !draft ? (
        <p className="card p-6 text-sm text-fg-muted">{k.empty}</p>
      ) : (
        <ul className="space-y-3">
          {rules.map((r) => (
            <li key={r.id} className={clsx("card p-4", !(enabled[r.id] ?? r.enabled) && "opacity-70")}>
              <div className="flex flex-wrap items-start gap-3">
                <label className="mt-0.5 flex items-center" title={k.enabled}>
                  <input
                    type="checkbox"
                    checked={enabled[r.id] ?? r.enabled}
                    disabled={pending}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setEnabled((x) => ({ ...x, [r.id]: on }));
                      run(() => api(`/automations/${r.id}`, "PATCH", { enabled: on }), undefined, () => setEnabled((x) => ({ ...x, [r.id]: !on })));
                    }}
                    aria-label={`${k.enabled}: ${r.name}`}
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.name}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    <span className="font-medium text-fg">{k.when}:</span> {k.triggers[r.trigger]}
                    {describeConditions(r) && ` · ${describeConditions(r)}`}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
                    {r.actions.map((a, i) => (
                      <li key={i}>→ {describeAction(a)}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-fg-subtle">
                    {interpolate(k.runCount, { n: r.runCount })}
                    {r.lastRunAt && ` · ${interpolate(k.lastRun, { date: formatDateTime(r.lastRunAt, locale) })}`}
                  </p>
                  {r.lastError && (
                    <p className="mt-1 rounded-md bg-danger/10 px-2 py-1 text-xs text-danger">
                      {k.lastError}: {r.lastError}
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => void showRuns(r.id)} className="btn-ghost h-8 border border-border text-xs">
                    {k.runs}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft({ id: r.id, name: r.name, trigger: r.trigger, conditions: r.conditions, actions: r.actions, enabled: r.enabled })}
                    className="grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-muted"
                    aria-label={`${k.edit}: ${r.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => window.confirm(interpolate(k.confirmDelete, { name: r.name })) && run(() => api(`/automations/${r.id}`, "DELETE"))}
                    className="grid h-8 w-8 place-items-center rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"
                    aria-label={`${k.delete}: ${r.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {runs?.id === r.id && (
                <div className="mt-3 border-t border-border pt-3">
                  {runs.items.length === 0 ? (
                    <p className="text-xs text-fg-subtle">{k.noRuns}</p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {runs.items.map((x) => (
                        <li key={x.id} className="flex gap-3">
                          <span className="w-28 shrink-0 text-fg-subtle">{formatDateTime(x.createdAt, locale)}</span>
                          <span className={clsx("w-16 shrink-0 font-medium", x.status === "failed" ? "text-danger" : x.status === "success" ? "text-success" : "text-fg-muted")}>{k.runStatuses[x.status]}</span>
                          <span className="min-w-0 truncate text-fg-muted">{x.detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleEditor({
  draft,
  setDraft,
  members,
  stages,
  pending,
  onSubmit,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  members: Member[];
  stages: StageDto[];
  pending: boolean;
  onSubmit: (e: FormEvent) => void;
}) {
  const { t } = useI18n();
  const k = t.automations;
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const setCond = (patch: Partial<Draft["conditions"]>) => {
    const next = { ...draft.conditions, ...patch };
    for (const key of Object.keys(next) as (keyof typeof next)[]) if (next[key] === undefined || next[key] === "") delete next[key];
    set({ conditions: next });
  };
  const setAction = (i: number, a: AutomationAction) => set({ actions: draft.actions.map((x, j) => (j === i ? a : x)) });

  const changeTrigger = (trigger: AutomationTrigger) => {
    // Conditions of another trigger make no sense: start clean
    set({ trigger, conditions: {} });
  };

  const memberOptions = members.map((m) => (
    <option key={m.id} value={m.id}>
      {m.name}
    </option>
  ));

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-5" aria-label={draft.id ? k.edit : k.new}>
      <div className="flex items-start justify-between gap-3">
        <label className="field-label flex-1">
          {k.name}
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} required minLength={2} maxLength={100} className="input" />
        </label>
        <button type="button" onClick={() => setDraft(null)} className="mt-6 grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-muted" aria-label={k.cancel}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <label className="field-label">
        {k.when}
        <select value={draft.trigger} onChange={(e) => changeTrigger(e.target.value as AutomationTrigger)} className="input">
          {AUTOMATION_TRIGGERS.map((tr) => (
            <option key={tr} value={tr}>
              {k.triggers[tr]}
            </option>
          ))}
        </select>
      </label>

      {draft.trigger !== "task.overdue" && (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-xs font-medium text-fg-muted">{k.conditions}</legend>
          {DEAL_TRIGGERS.has(draft.trigger) && (
            <>
              <label className="field-label">
                {k.stage}
                <select value={draft.conditions.stageId ?? ""} onChange={(e) => setCond({ stageId: e.target.value || undefined })} className="input">
                  <option value="">{k.anyStage}</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                {k.minAmount}
                <input
                  inputMode="decimal"
                  defaultValue={draft.conditions.minAmount !== undefined ? moneyInputValue(draft.conditions.minAmount) : ""}
                  onChange={(e) => setCond({ minAmount: e.target.value.trim() ? (parseMoneyInput(e.target.value) ?? undefined) : undefined })}
                  className="input"
                />
              </label>
            </>
          )}
          {draft.trigger === "contact.created" && (
            <label className="field-label">
              {k.source}
              <select value={draft.conditions.source ?? ""} onChange={(e) => setCond({ source: (e.target.value || undefined) as Draft["conditions"]["source"] })} className="input">
                <option value="">{k.anySource}</option>
                {CONTACT_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {t.crm.sources[s]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.trigger === "conversation.created" && (
            <label className="field-label">
              {k.channel}
              <select value={draft.conditions.channelType ?? ""} onChange={(e) => setCond({ channelType: (e.target.value || undefined) as Draft["conditions"]["channelType"] })} className="input">
                <option value="">{k.anyChannel}</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {t.channels.types[c]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
      )}

      <fieldset className="space-y-3">
        <legend className="mb-2 text-xs font-medium text-fg-muted">{k.then}</legend>
        {draft.actions.map((a, i) => (
          <div key={i} className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <select
                value={a.type}
                onChange={(e) => setAction(i, blankAction(e.target.value as AutomationAction["type"], members))}
                className="input mt-0 w-auto"
                aria-label={k.then}
              >
                {(["create_task", "notify", "assign"] as const).map((type) => (
                  <option key={type} value={type}>
                    {k.actionTypes[type]}
                  </option>
                ))}
              </select>
              {draft.actions.length > 1 && (
                <button
                  type="button"
                  onClick={() => set({ actions: draft.actions.filter((_, j) => j !== i) })}
                  className="ml-auto grid h-7 w-7 place-items-center rounded-md text-fg-subtle hover:bg-danger/10 hover:text-danger"
                  aria-label={k.removeAction}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {a.type === "create_task" && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="field-label sm:col-span-2">
                  {k.taskTitle}
                  <input value={a.title} onChange={(e) => setAction(i, { ...a, title: e.target.value })} required minLength={2} maxLength={200} className="input" />
                  <span className="mt-1 block text-[11px] font-normal text-fg-subtle">{k.titleHint}</span>
                </label>
                <label className="field-label">
                  {k.dueInDays}
                  <input type="number" min={0} max={365} value={a.dueInDays} onChange={(e) => setAction(i, { ...a, dueInDays: Number(e.target.value) })} className="input" />
                </label>
                <label className="field-label">
                  {k.assignee}
                  <select value={a.assignee} onChange={(e) => setAction(i, { ...a, assignee: e.target.value })} className="input">
                    <option value="owner">{k.recordOwner}</option>
                    {memberOptions}
                  </select>
                </label>
                <label className="field-label">
                  {k.priority}
                  <select value={a.priority} onChange={(e) => setAction(i, { ...a, priority: e.target.value as (typeof PRIORITIES)[number] })} className="input">
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {t.admin.tickets.priorities[p]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {a.type === "notify" && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="field-label">
                  {k.assignee}
                  <select value={a.recipient} onChange={(e) => setAction(i, { ...a, recipient: e.target.value })} className="input">
                    <option value="owner">{k.recordOwner}</option>
                    <option value="managers">{k.managers}</option>
                    {memberOptions}
                  </select>
                </label>
                <label className="field-label">
                  {k.message}
                  <input value={a.message} onChange={(e) => setAction(i, { ...a, message: e.target.value })} required minLength={2} maxLength={300} className="input" />
                  <span className="mt-1 block text-[11px] font-normal text-fg-subtle">{k.titleHint}</span>
                </label>
              </div>
            )}
            {a.type === "assign" && (
              <fieldset className="mt-3">
                <legend className="text-xs text-fg-muted">{k.assignTo}</legend>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {members.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={a.memberIds.includes(m.id)}
                        onChange={(e) => setAction(i, { ...a, memberIds: e.target.checked ? [...a.memberIds, m.id] : a.memberIds.filter((x) => x !== m.id) })}
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        ))}
        {draft.actions.length < 5 && (
          <button type="button" onClick={() => set({ actions: [...draft.actions, blankAction("create_task", members)] })} className="btn-ghost h-8 border border-dashed border-border text-xs">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {k.addAction}
          </button>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        {k.enabled}
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="btn-primary">
          {k.save}
        </button>
        <button type="button" onClick={() => setDraft(null)} className="btn-ghost">
          {k.cancel}
        </button>
      </div>
    </form>
  );
}
