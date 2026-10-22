import "server-only";
import type {
  ActivityItem,
  ChannelType,
  ConversationPreview,
  DashboardData,
  MemberPerformance,
  MemberRef,
  Period,
  Priority,
  RevenuePoint,
  TaskPreview,
} from "./types";

// DEMO DATA SOURCE for dashboard numbers and sidebar counters — replaced by API calls in Phases 2–4 (docs/ARCHITECTURE.md §11).
// Output is deterministic for a given day so numbers don't jump on every refresh,
// and internally consistent (KPI totals equal the sum of their breakdowns).

const MIN = 60_000;
const DAY = 1440 * MIN;

function rng(seed: number) {
  // mulberry32
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: () => number, min: number, max: number) => Math.floor(r() * (max - min + 1)) + min;
const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;

const PERIOD_DAYS: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 };

const MEMBERS: (MemberRef & { title: string; weight: number; inbox: boolean })[] = [
  { id: "m1", name: "Kamran Əliyev", title: "Direktor", weight: 0.6, inbox: false },
  { id: "m2", name: "Aysel Hüseynova", title: "Satış meneceri", weight: 1.4, inbox: true },
  { id: "m3", name: "Tural Məmmədov", title: "Satış meneceri", weight: 1.1, inbox: true },
  { id: "m4", name: "Nigar Qasımova", title: "Müştəri dəstəyi", weight: 0.5, inbox: true },
  { id: "m5", name: "Elvin Rzayev", title: "Layihə meneceri", weight: 0.4, inbox: false },
  { id: "m6", name: "Leyla Abbasova", title: "Marketoloq", weight: 0.3, inbox: true },
];

const CONTACTS = [
  "Orxan Səfərov", "Günay Babayeva", "Rəşad İsmayılov", "Sevinc Quliyeva", "Fərid Nəsirov",
  "Aynur Kərimova", "Murad Həsənov", "Lalə Əhmədova", "Vüsal Cəfərov", "Nərmin Vəliyeva",
  "Bakı Tekstil MMC", "Gəncə Aqro", "Caspian Logistics", "Nur Klinika", "Şəhər Mebel",
];

const DEALS = [
  "CRM lisenziyası — 12 istifadəçi", "Ofis avadanlığı tədarükü", "İllik xidmət müqaviləsi",
  "Veb-sayt yenilənməsi", "Anbar avtomatlaşdırılması", "Korporativ təlim paketi",
  "Marketinq kampaniyası Q4", "Server icarəsi", "Mobil tətbiq MVP", "Konsaltinq — 3 ay",
];

const STAGES = ["Təklif göndərildi", "Danışıqlar", "Müqavilə", "Kvalifikasiya"];

const TASKS = [
  "Müqavilə layihəsini hüquqşünasa göndər", "Q3 hesabatını hazırla", "Yeni qiymət təklifini təsdiqlə",
  "Müştəriyə geri zəng — demo görüş", "Anbar qalığını yoxla", "Fakturanı yenidən göndər",
  "Sayt üçün banner dizaynı", "Təchizatçı ilə görüş təyin et", "İşçi təlim planını yenilə",
];

const MESSAGES = [
  "Salam, qiymət təklifini göndərə bilərsiniz?", "Sifarişim nə vaxt çatdırılacaq?",
  "Endirim var? 20 ədəd götürmək istəyirik", "Faktura gəlmədi, yoxlayın zəhmət olmasa",
  "Sabah ofisə gəlmək olar?", "Ödənişi kartla etmək mümkündür?", "Demo görüş üçün vaxt təyin edək",
];

const CHANNELS: ChannelType[] = ["WHATSAPP", "WHATSAPP", "INSTAGRAM", "MESSENGER", "WEBCHAT"];
const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "URGENT"];

function dayIndex(now: Date) {
  return Math.floor(now.getTime() / DAY);
}

const BAKU_OFFSET = 4 * 60 * MIN;
const bakuMidnight = (ms: number) => Math.floor((ms + BAKU_OFFSET) / DAY) * DAY - BAKU_OFFSET;

const ref = (m: MemberRef): MemberRef => ({ id: m.id, name: m.name });

/** Current-state snapshot (independent of the selected period). */
function snapshot(now: Date) {
  const r = rng(dayIndex(now) * 7 + 1);

  const awaitingCount = int(r, 6, 14);
  const inboxMembers = MEMBERS.filter((m) => m.inbox);
  const conversations: ConversationPreview[] = Array.from({ length: awaitingCount }, (_, i) => ({
    id: `c${i + 1}`,
    channel: pick(r, CHANNELS),
    contactName: pick(r, CONTACTS),
    preview: pick(r, MESSAGES),
    waitingSince: new Date(now.getTime() - int(r, 3, 300) * MIN).toISOString(),
    assignee: r() < 0.3 ? null : ref(pick(r, inboxMembers)),
  })).sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));

  const overdueCount = int(r, 3, 9);
  const overdue: TaskPreview[] = Array.from({ length: overdueCount }, (_, i) => ({
    id: `t${i + 1}`,
    title: pick(r, TASKS),
    dueAt: new Date(now.getTime() - int(r, 2 * 60, 6 * 1440) * MIN).toISOString(),
    priority: pick(r, PRIORITIES),
    assignee: ref(pick(r, MEMBERS)),
  })).sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  return { conversations, overdue, openTasks: overdueCount + int(r, 18, 40) };
}

function revenueSeries(r: () => number, now: Date, days: number) {
  const bucket = days > 30 ? "week" : "day";
  const step = bucket === "week" ? 7 : 1;
  const points: RevenuePoint[] = [];
  for (let offset = days - step; offset >= 0; offset -= step) {
    const date = new Date(bakuMidnight(now.getTime() - offset * DAY));
    let amount = 0;
    let deals = 0;
    for (let d = 0; d < step; d++) {
      const weekday = new Date(date.getTime() + d * DAY + BAKU_OFFSET).getUTCDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const n = isWeekend ? int(r, 0, 1) : int(r, 0, 4);
      deals += n;
      for (let k = 0; k < n; k++) amount += int(r, 150, 4200) * 100;
    }
    points.push({ date: date.toISOString(), amount, deals });
  }
  return { bucket, points } as const;
}

/** Splits `total` across members proportionally to their weight, remainder to the top seller. */
function distribute(total: number, r: () => number) {
  const weights = MEMBERS.map((m) => m.weight * (0.6 + r() * 0.8));
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.floor(((total * w) / sum) / 100) * 100);
  const rest = total - shares.reduce((a, b) => a + b, 0);
  shares[shares.indexOf(Math.max(...shares))]! += rest;
  return shares;
}

function teamPerformance(r: () => number, revenue: number, deals: number, overdue: TaskPreview[], days: number) {
  const revenueShares = distribute(revenue, r);
  const dealShares = distribute(deals * 100, r).map((v) => Math.round(v / 100));
  // Fix rounding so deal counts add up exactly
  dealShares[0]! += deals - dealShares.reduce((a, b) => a + b, 0);

  return MEMBERS.map<MemberPerformance>((m, i) => ({
    member: { id: m.id, name: m.name, title: m.title },
    dealsWon: Math.max(0, dealShares[i]!),
    revenue: revenueShares[i]!,
    tasksDone: Math.round(int(r, 2, 6) * (days / 7) * (m.weight > 0.5 ? 1 : 0.7)),
    tasksOverdue: overdue.filter((t) => t.assignee.id === m.id).length,
    avgResponseMin: m.inbox ? int(r, 4, 55) : null,
  }));
}

function activityFeed(r: () => number, now: Date): ActivityItem[] {
  const items: ActivityItem[] = [];
  let at = now.getTime() - int(r, 2, 10) * MIN;
  for (let i = 0; i < 12; i++) {
    const actor = ref(pick(r, MEMBERS));
    const base = { id: `a${i}`, at: new Date(at).toISOString() };
    const roll = r();
    if (roll < 0.22) items.push({ ...base, kind: "deal_won", actor, subject: pick(r, DEALS), amount: int(r, 300, 6000) * 100 });
    else if (roll < 0.42) items.push({ ...base, kind: "deal_stage", actor, subject: pick(r, DEALS), stage: pick(r, STAGES) });
    else if (roll < 0.6) items.push({ ...base, kind: "contact_created", actor, subject: pick(r, CONTACTS) });
    else if (roll < 0.8) items.push({ ...base, kind: "task_done", actor, subject: pick(r, TASKS) });
    else if (roll < 0.96) items.push({ ...base, kind: "message_in", subject: pick(r, CONTACTS), channel: pick(r, CHANNELS) });
    else items.push({ ...base, kind: "member_joined", subject: "Səbinə Mustafayeva" });
    at -= int(r, 8, 140) * MIN;
  }
  return items;
}

export function demoShellSummary(now: Date) {
  const s = snapshot(now);
  return { awaiting: s.conversations.length, overdue: s.overdue.length, demo: true };
}

export function demoDashboard(period: Period, now: Date): DashboardData {
  const days = PERIOD_DAYS[period];
  const r = rng(dayIndex(now) * 31 + days);
  const snap = snapshot(now);

  const revenue = revenueSeries(r, now, days);
  const revenueTotal = revenue.points.reduce((a, p) => a + p.amount, 0);
  const dealsTotal = revenue.points.reduce((a, p) => a + p.deals, 0);
  const newContacts = Math.round(days * (1.2 + r() * 1.3));
  const activeDeals = int(r, 24, 48);

  return {
    period,
    generatedAt: now.toISOString(),
    scope: "all",
    kpis: {
      newContacts: { value: newContacts, previous: Math.round(newContacts * (0.75 + r() * 0.45)) },
      activeDeals: { value: activeDeals, previous: activeDeals + int(r, -6, 6), pipelineValue: activeDeals * int(r, 900, 2400) * 100 },
      revenue: { value: revenueTotal, previous: Math.round((revenueTotal * (0.7 + r() * 0.5)) / 100) * 100 },
      awaiting: {
        value: snap.conversations.length,
        longestWaitMin: Math.round((now.getTime() - new Date(snap.conversations[0]!.waitingSince).getTime()) / MIN),
      },
      openTasks: { value: snap.openTasks, overdue: snap.overdue.length },
    },
    revenue,
    inbox: { avgFirstResponseMin: int(r, 6, 28), items: snap.conversations.slice(0, 5) },
    overdueTasks: snap.overdue.slice(0, 5),
    team: teamPerformance(r, revenueTotal, dealsTotal, snap.overdue, days),
    activity: activityFeed(r, now),
  };
}
