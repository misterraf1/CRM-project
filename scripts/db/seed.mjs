import "./load-env.mjs";
import { hash } from "@node-rs/argon2";
import { MongoClient } from "mongodb";
import { randomBytes } from "node:crypto";
import { DEFAULTS } from "../../src/server/db/models.ts";

// Idempotent: safe to run on every `npm run db:start`.
// Plans always; the demo workspace only when SEED_DEMO !== "false".
// Run with --experimental-strip-types (default on Node 23.6+): the defaults come from the API's models.ts.

// Seeding is a platform operation: plain driver, outside the API tenant guard
const client = new MongoClient(process.env.DATABASE_URL);
const mongo = client.db();

const newId = () => `c${Date.now().toString(36)}${randomBytes(9).toString("base64url")}`;

/** A document as the API would write it: schema defaults, explicit nulls, `_id`. */
function withDefaults(model, data) {
  const now = new Date();
  const out = {};
  for (const [k, v] of Object.entries(DEFAULTS[model])) out[k] = v === "now" ? now : Array.isArray(v) ? [...v] : v && typeof v === "object" ? { ...v } : v;
  for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = v;
  const { id, ...rest } = out;
  return { _id: id ?? newId(), ...rest };
}

const fromMongo = (d) => d && (({ _id, ...rest }) => ({ id: _id, ...rest }))(d);
const toMongo = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k === "id" ? "_id" : k, v]));

/** Collections by model, with the API's `id` convention; `session` joins a transaction. */
function collections(session) {
  const repo = (model) => {
    const c = mongo.collection(model);
    return {
      async insertOne(data) {
        const doc = withDefaults(model, data);
        await c.insertOne(doc, { session });
        return fromMongo(doc);
      },
      async insertMany(rows) {
        const docs = rows.map((r) => withDefaults(model, r));
        if (docs.length) await c.insertMany(docs, { session });
        return docs.map(fromMongo);
      },
      findOne: async (filter) => fromMongo(await c.findOne(toMongo(filter), { session })),
      find: async (filter, { sort } = {}) => (await c.find(toMongo(filter), { session, sort }).toArray()).map(fromMongo),
      count: (filter) => c.countDocuments(toMongo(filter), { session }),
      /** Inserts when missing; `update` ($set fields) applies to an existing document. */
      async upsert(filter, insert, update = {}) {
        const existing = await c.findOne(toMongo(filter), { session });
        if (!existing) return this.insertOne(insert);
        if (Object.keys(update).length) await c.updateOne({ _id: existing._id }, { $set: update }, { session });
        return fromMongo({ ...existing, ...update });
      },
    };
  };
  return new Proxy({}, { get: (_, name) => repo(name[0].toUpperCase() + name.slice(1)) });
}

const db = collections();

async function transaction(fn) {
  const session = client.startSession();
  try {
    await session.withTransaction(() => fn(collections(session)));
  } finally {
    await session.endSession();
  }
}

const PLANS = [
  {
    code: "START",
    name: "Start",
    priceMonthly: 3900,
    priceYearly: 39000,
    seatLimit: 3,
    storageMb: 2048,
    aiCredits: 0,
    features: ["crm.basic", "tasks", "team_chat", "inbox.webchat"],
    sortOrder: 1,
  },
  {
    code: "PRO",
    name: "Pro",
    priceMonthly: 9900,
    priceYearly: 99000,
    seatLimit: 10,
    storageMb: 10240,
    aiCredits: 100,
    features: ["crm.basic", "tasks", "team_chat", "inbox.webchat", "inbox.omnichannel", "deals.pipeline", "team.monitoring", "analytics.basic"],
    sortOrder: 2,
  },
  {
    code: "BUSINESS",
    name: "Business",
    priceMonthly: 19900,
    priceYearly: 199000,
    seatLimit: 25,
    storageMb: 51200,
    aiCredits: 500,
    features: [
      "crm.basic", "tasks", "team_chat", "inbox.webchat", "inbox.omnichannel", "deals.pipeline", "team.monitoring",
      "analytics.basic", "analytics.advanced", "automations", "departments", "support.priority",
    ],
    sortOrder: 3,
  },
];

// Demo workspace — one account per role, to try permissions quickly.
const DEMO_PASSWORD = "demo12345";
const LOST_REASON = "Qiymət baha gəldi";
const DEMO_TENANT = { id: "tenant_demo", slug: "demo", name: "Demo Şirkət MMC" };
const DEMO_MEMBERS = [
  { email: "owner@demo.axis", fullName: "Kamran Əliyev", role: "OWNER", title: "Direktor" },
  { email: "admin@demo.axis", fullName: "Aysel Hüseynova", role: "ADMIN", title: "Ofis meneceri" },
  { email: "manager@demo.axis", fullName: "Tural Məmmədov", role: "MANAGER", title: "Satış rəhbəri" },
  { email: "employee@demo.axis", fullName: "Nigar Qasımova", role: "EMPLOYEE", title: "Satış meneceri" },
];

async function seedPlans() {
  for (const plan of PLANS) {
    await db.plan.upsert({ code: plan.code }, plan);
  }
}

async function seedDemo() {
  const passwordHash = await hash(DEMO_PASSWORD);
  // Trials run on the top plan so every feature can be tried
  const pro = await db.plan.findOne({ code: "BUSINESS" });
  const now = new Date();

  await transaction(async (tx) => {
    if (await tx.tenant.findOne({ id: DEMO_TENANT.id })) return;

    await tx.tenant.insertOne({ ...DEMO_TENANT, status: "TRIALING" });
    await tx.subscription.insertOne({
      tenantId: DEMO_TENANT.id,
      planId: pro.id,
      status: "TRIALING",
      trialEndsAt: new Date(now.getTime() + 14 * 86400_000),
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 14 * 86400_000),
    });
    const sales = await tx.department.insertOne({ tenantId: DEMO_TENANT.id, name: "Satış" });
    for (const m of DEMO_MEMBERS) {
      const user = await tx.user.upsert({ email: m.email }, { email: m.email, fullName: m.fullName, passwordHash, emailVerified: now });
      await tx.membership.insertOne({
        tenantId: DEMO_TENANT.id,
        userId: user.id,
        role: m.role,
        status: "ACTIVE",
        title: m.title,
        departmentId: m.role === "MANAGER" || m.role === "EMPLOYEE" ? sales.id : null,
        joinedAt: now,
      });
    }
    console.log(`Demo workspace: ${DEMO_MEMBERS.map((m) => m.email).join(", ")} / ${DEMO_PASSWORD}`);
  });
}

// Same stages the API creates on signup (src/server/auth/auth.service.ts)
const DEFAULT_STAGES = [
  { name: "Yeni", probability: 10, kind: "open" },
  { name: "Kvalifikasiya", probability: 25, kind: "open" },
  { name: "Təklif", probability: 50, kind: "open" },
  { name: "Danışıqlar", probability: 75, kind: "open" },
  { name: "Qazanıldı", probability: 100, kind: "won" },
  { name: "İtirildi", probability: 0, kind: "lost" },
];

const DEMO_CONTACTS = [
  ["Orxan Səfərov", "person", "+994501234567", "orxan@example.az", "Caspian Logistics", "CUSTOMER", "whatsapp"],
  ["Günay Babayeva", "person", "+994552345678", "gunay@example.az", null, "QUALIFIED", "instagram"],
  ["Bakı Tekstil MMC", "company", "+994124567890", "info@bakitekstil.example", null, "CUSTOMER", "referral"],
  ["Rəşad İsmayılov", "person", "+994703456789", null, "Nur Klinika", "LEAD", "website"],
  ["Gəncə Aqro", "company", "+994222345678", "sales@gencaqro.example", null, "QUALIFIED", "phone"],
  ["Sevinc Quliyeva", "person", "+994514567890", "sevinc@example.az", null, "LEAD", "whatsapp"],
  ["Şəhər Mebel", "company", null, "office@seher.example", null, "CHURNED", "manual"],
  ["Fərid Nəsirov", "person", "+994775678901", null, null, "LEAD", "instagram"],
];

// [title, contact index, stage index, amount AZN, owner index, days ago closed (won/lost)]
const DEMO_DEALS = [
  ["CRM lisenziyası — 12 istifadəçi", 0, 4, 4800, 2, 3],
  ["Anbar avtomatlaşdırılması", 2, 4, 12500, 2, 12],
  ["İllik xidmət müqaviləsi", 2, 4, 6000, 3, 26],
  ["Korporativ təlim paketi", 0, 4, 2200, 3, 45],
  ["Veb-sayt yenilənməsi", 1, 2, 3500, 3, null],
  ["Mobil tətbiq MVP", 4, 3, 18000, 2, null],
  ["Marketinq kampaniyası Q4", 1, 1, 2700, 3, null],
  ["Ofis avadanlığı tədarükü", 3, 0, 1500, 2, null],
  ["Konsaltinq — 3 ay", 4, 2, 9000, 0, null],
  ["Server icarəsi", 6, 5, 4000, 3, 8],
];

async function seedDemoCrm() {
  await transaction(async (tx) => {
    let pipeline = await tx.pipeline.findOne({ tenantId: DEMO_TENANT.id, isDefault: true });
    if (!pipeline) {
      pipeline = await tx.pipeline.insertOne({ tenantId: DEMO_TENANT.id, name: "Satış", isDefault: true });
      await tx.pipelineStage.insertMany(DEFAULT_STAGES.map((st, order) => ({ ...st, order, tenantId: DEMO_TENANT.id, pipelineId: pipeline.id })));
    }
    if (await tx.contact.count({ tenantId: DEMO_TENANT.id })) return;

    const stages = await tx.pipelineStage.find({ pipelineId: pipeline.id }, { sort: { order: 1 } });
    const members = await tx.membership.find({ tenantId: DEMO_TENANT.id }, { sort: { createdAt: 1 } });
    const day = 86400_000;
    const contacts = [];
    // Timeline rows mirror what the API writes (src/server/crm/activity.service.ts)
    const activity = (type, at, actorId, ref, payload) => tx.activity.insertOne({ tenantId: DEMO_TENANT.id, type, actorId, createdAt: at, payload, ...ref });
    for (const [i, [name, type, phone, email, companyName, stage, source]] of DEMO_CONTACTS.entries()) {
      const createdAt = new Date(Date.now() - (i * 9 + 1) * day);
      const ownerId = members[(i % 3) + 1]?.id ?? null;
      const c = await tx.contact.insertOne({ tenantId: DEMO_TENANT.id, name, type, phone, email, companyName, stage, source, ownerId, createdAt });
      contacts.push(c);
      await activity("contact_created", createdAt, ownerId, { contactId: c.id }, { contactName: name });
    }
    for (const [n, [title, ci, si, azn, oi, closedDaysAgo]] of DEMO_DEALS.entries()) {
      const stage = stages[si];
      const closedAt = closedDaysAgo === null ? null : new Date(Date.now() - closedDaysAgo * day);
      const ownerId = members[oi]?.id ?? null;
      // Created before it closed, so cycle-time analytics see a real sales cycle
      const createdAt = new Date((closedAt ?? new Date()).getTime() - 5 * day);
      const deal = await tx.deal.insertOne({
        tenantId: DEMO_TENANT.id, pipelineId: pipeline.id, stageId: stage.id, title,
        amount: azn * 100, contactId: contacts[ci].id, ownerId,
        position: (n + 1) * 1024, closedAt, createdAt,
        lostReason: stage.kind === "lost" ? LOST_REASON : null,
      });
      const ref = { dealId: deal.id, contactId: contacts[ci].id };
      await activity("deal_created", createdAt, ownerId, ref, { dealTitle: title, amount: azn * 100, stage: stages[0].name, contactName: contacts[ci].name });
      if (stage.kind === "won") await activity("deal_won", closedAt, ownerId, ref, { dealTitle: title, amount: azn * 100 });
      if (stage.kind === "lost") await activity("deal_lost", closedAt, ownerId, ref, { dealTitle: title, amount: azn * 100, reason: LOST_REASON });
    }
    console.log(`Demo CRM: ${DEMO_CONTACTS.length} contacts, ${DEMO_DEALS.length} deals`);
  });
}

// [title, assignee index, due in hours (negative = overdue), status, priority, contact index]
const DEMO_TASKS = [
  ["Müqavilə layihəsini hüquqşünasa göndər", 2, -30, "TODO", "HIGH", 4],
  ["Q4 hesabatını hazırla", 1, -4, "IN_PROGRESS", "URGENT", null],
  ["Günay xanıma qiymət təklifi göndər", 3, 6, "TODO", "MEDIUM", 1],
  ["Demo görüş — Gəncə Aqro", 2, 28, "TODO", "HIGH", 4],
  ["Anbar qalığını yoxla", 3, 50, "REVIEW", "LOW", null],
  ["Fakturanı yenidən göndər", 3, -52, "TODO", "MEDIUM", 2],
  ["Yeni işçi üçün təlim planı", 0, 120, "TODO", "LOW", null],
  ["Həftəlik satış iclası", 0, 72, "TODO", "MEDIUM", null],
];

async function seedDemoTasks() {
  await transaction(async (tx) => {
    if (await tx.task.count({ tenantId: DEMO_TENANT.id })) return;
    const members = await tx.membership.find({ tenantId: DEMO_TENANT.id }, { sort: { createdAt: 1 } });
    const contacts = await tx.contact.find({ tenantId: DEMO_TENANT.id }, { sort: { createdAt: -1 } });
    const byName = (i) => (i === null ? null : contacts.find((c) => c.name === DEMO_CONTACTS[i][0])?.id ?? null);
    const project = await tx.project.insertOne({ tenantId: DEMO_TENANT.id, name: "Q4 satış planı", ownerId: members[0].id });
    const hour = 3600_000;
    for (const [n, [title, ai, dueH, status, priority, ci]] of DEMO_TASKS.entries()) {
      const task = await tx.task.insertOne({
        tenantId: DEMO_TENANT.id, title, status, priority,
        creatorId: members[0].id, assigneeId: members[ai].id,
        dueAt: new Date(Date.now() + dueH * hour),
        contactId: byName(ci), projectId: n < 4 ? project.id : null,
        recurrence: title.startsWith("Həftəlik") ? "FREQ=WEEKLY" : null,
        position: (n + 1) * 1024,
      });
      if (n === 1) {
        await tx.task.insertMany(
          ["Satış rəqəmlərini topla", "Qrafikləri hazırla"].map((t, i) => ({
            tenantId: DEMO_TENANT.id, title: t, parentId: task.id, creatorId: members[1].id, assigneeId: members[1].id,
            status: i === 0 ? "DONE" : "TODO", completedAt: i === 0 ? new Date() : null, position: (i + 1) * 1024,
          })),
        );
        await tx.taskComment.insertOne({ tenantId: DEMO_TENANT.id, taskId: task.id, authorId: members[0].id, body: "Cümə gününə qədər hazır olsun, zəhmət olmasa." });
      }
    }
    console.log(`Demo tasks: ${DEMO_TASKS.length}`);
  });
}

// Demo inbox: a website chat (real widget) and a demo WhatsApp channel (nothing is sent to Meta)
async function seedDemoInbox() {
  await transaction(async (tx) => {
    if (await tx.channel.count({ tenantId: DEMO_TENANT.id })) return;
    const members = await tx.membership.find({ tenantId: DEMO_TENANT.id }, { sort: { createdAt: 1 } });
    const contacts = await tx.contact.find({ tenantId: DEMO_TENANT.id });
    const contact = (name) => contacts.find((c) => c.name === name) ?? null;
    const web = await tx.channel.insertOne({
      tenantId: DEMO_TENANT.id, type: "WEBCHAT", name: "Sayt çatı", externalId: "web_demo", settings: { greeting: "Salam! Sualınızı yazın, tezliklə cavab verəcəyik." },
    });
    const wa = await tx.channel.insertOne({ tenantId: DEMO_TENANT.id, type: "WHATSAPP", name: "WhatsApp (demo)", externalId: "demo_whatsapp", demo: true });
    const min = 60_000;
    const convs = [
      { channel: wa, thread: "sim_orxan", name: "Orxan Səfərov", handle: "+994501234567", assignee: 1, msgs: [["IN", 190, "Salam, sifarişim nə vaxt çatdırılacaq?"]] },
      { channel: wa, thread: "sim_gunay", name: "Günay Babayeva", handle: "+994552345678", assignee: null, msgs: [["IN", 75, "Endirim var? 20 ədəd götürmək istəyirik"], ["IN", 74, "Topdan qiymət lazımdır"]] },
      { channel: web, thread: "web_visitor_1", name: "Leyla", handle: "leyla@example.az", assignee: 3, msgs: [["IN", 300, "Demo görüş üçün vaxt təyin edə bilərikmi?"], ["NOTE", 290, "Tural bəyə ötürürəm, sabah 11:00 uyğundur"], ["OUT", 285, "Salam Leyla! Sabah saat 11:00 sizə uyğundurmu?"], ["IN", 20, "Bəli, uyğundur. Ünvanı göndərin zəhmət olmasa"]] },
      { channel: wa, thread: "sim_resad", name: "Rəşad İsmayılov", handle: "+994703456789", assignee: 2, resolved: true, msgs: [["IN", 2000, "Faktura gəlmədi"], ["OUT", 1980, "Üzr istəyirik, indicə yenidən göndərdik."], ["IN", 1975, "Aldım, təşəkkürlər!"]] },
    ];
    for (const c of convs) {
      const created = new Date(Date.now() - c.msgs[0][1] * min);
      const lastIn = [...c.msgs].reverse().find((m) => m[0] === "IN");
      const lastOut = [...c.msgs].reverse().find((m) => m[0] === "OUT");
      const awaiting = !c.resolved && (!lastOut || lastIn[1] < lastOut[1]);
      const firstOut = c.msgs.find((m) => m[0] === "OUT");
      const conv = await tx.conversation.insertOne({
          tenantId: DEMO_TENANT.id, channelId: c.channel.id, externalThread: c.thread, displayName: c.name, handle: c.handle,
          contactId: contact(c.name)?.id ?? null, assigneeId: c.assignee === null ? null : members[c.assignee].id,
          status: c.resolved ? "RESOLVED" : "OPEN", createdAt: created,
          lastMessageAt: new Date(Date.now() - c.msgs[c.msgs.length - 1][1] * min), lastInboundAt: new Date(Date.now() - lastIn[1] * min),
          awaitingSince: awaiting ? new Date(Date.now() - (c.msgs.filter((m) => m[0] === "IN" && (!lastOut || m[1] < lastOut[1]))[0]?.[1] ?? lastIn[1]) * min) : null,
          unreadCount: awaiting ? c.msgs.filter((m) => m[0] === "IN" && (!lastOut || m[1] < lastOut[1])).length : 0,
          firstResponseMs: firstOut ? (c.msgs[0][1] - firstOut[1]) * min : null,
      });
      for (const [dir, ago, body] of c.msgs) {
        await tx.message.insertOne({
            tenantId: DEMO_TENANT.id, conversationId: conv.id, body, createdAt: new Date(Date.now() - ago * min),
            direction: dir === "IN" ? "INBOUND" : dir === "OUT" ? "OUTBOUND" : "INTERNAL_NOTE",
            authorId: dir === "IN" ? null : members[c.assignee ?? 0].id,
            deliveryStatus: dir === "OUT" ? (c.channel.demo ? "demo" : "sent") : null,
        });
      }
    }
    await tx.cannedResponse.insertMany([
      { tenantId: DEMO_TENANT.id, shortcut: "/salam", body: "Salam! Axis komandasıdır, sizə necə kömək edə bilərik?" },
      { tenantId: DEMO_TENANT.id, shortcut: "/catdirilma", body: "Sifarişlər Bakı daxilində 1–2 iş günü ərzində çatdırılır." },
      { tenantId: DEMO_TENANT.id, shortcut: "/sag", body: "Müraciətiniz üçün təşəkkür edirik! Uğurlar." },
    ]);
    console.log(`Demo inbox: 2 channels, ${convs.length} conversations`);
  });
}

// Demo team chat: department room (Satış), a management group and a direct chat
async function seedDemoChat() {
  await transaction(async (tx) => {
    if (await tx.chatRoom.count({ tenantId: DEMO_TENANT.id })) return;
    const [owner, admin, manager, employee] = await tx.membership.find({ tenantId: DEMO_TENANT.id }, { sort: { createdAt: 1 } });
    const sales = await tx.department.findOne({ tenantId: DEMO_TENANT.id, name: "Satış" });
    const min = 60_000;
    const room = async (data, memberIds, msgs) => {
      const r = await tx.chatRoom.insertOne({ tenantId: DEMO_TENANT.id, ...data });
      await tx.chatMember.insertMany(memberIds.map((memberId) => ({ tenantId: DEMO_TENANT.id, roomId: r.id, memberId })));
      for (const [author, ago, body] of msgs) {
        await tx.chatMessage.insertOne({ tenantId: DEMO_TENANT.id, roomId: r.id, authorId: author.id, body, createdAt: new Date(Date.now() - ago * min) });
      }
    };
    if (sales) {
      await room({ kind: "department", name: sales.name, departmentId: sales.id }, [manager.id, employee.id], [
        [manager, 180, "Salam komanda! Bu həftə Gəncə Aqro ilə müqaviləni bağlamalıyıq."],
        [employee, 170, "Təklifi bu gün göndərirəm 👍"],
        [manager, 40, "Sabah 10:00-da qısa iclas edək."],
      ]);
    }
    await room({ kind: "group", name: "Rəhbərlik", createdById: owner.id }, [owner.id, admin.id, manager.id], [
      [owner, 300, "Oktyabr nəticələrini cümə günü müzakirə edək."],
      [admin, 290, "Hesabat hazırdır, paylaşacam."],
    ]);
    await room({ kind: "direct", directKey: [owner.id, manager.id].sort().join(":"), createdById: owner.id }, [owner.id, manager.id], [
      [manager, 25, "Kamran bəy, Mobil tətbiq MVP üzrə endirim verə bilərikmi?"],
    ]);
    console.log("Demo chat: 3 rooms");
  });
}

/**
 * Platform staff. Production: the first SUPER_ADMIN comes from PLATFORM_ADMIN_EMAIL /
 * PLATFORM_ADMIN_PASSWORD (the password is only set when the account is created).
 * Demo: platform@demo.axis (SUPER_ADMIN) and support@demo.axis (SUPPORT).
 */
async function seedPlatformStaff(demo) {
  const staff = [];
  if (process.env.PLATFORM_ADMIN_EMAIL && process.env.PLATFORM_ADMIN_PASSWORD) {
    staff.push({ email: process.env.PLATFORM_ADMIN_EMAIL.toLowerCase(), fullName: "Platform Admin", password: process.env.PLATFORM_ADMIN_PASSWORD, role: "SUPER_ADMIN" });
  }
  if (demo) {
    staff.push({ email: "platform@demo.axis", fullName: "Rafael Axis", password: DEMO_PASSWORD, role: "SUPER_ADMIN" });
    staff.push({ email: "support@demo.axis", fullName: "Səbinə Dəstək", password: DEMO_PASSWORD, role: "SUPPORT" });
  }
  for (const s of staff) {
    await db.user.upsert(
      { email: s.email },
      { email: s.email, fullName: s.fullName, passwordHash: await hash(s.password), platformRole: s.role, emailVerified: new Date() },
      { platformRole: s.role },
    );
  }
  if (staff.length) console.log(`Platform staff: ${staff.map((s) => `${s.email} (${s.role})`).join(", ")}`);
}

// Demo support ticket and platform costs (notes say "Demo" so they're never mistaken for real figures)
async function seedDemoPlatform() {
  await transaction(async (tx) => {
    if (await tx.supportTicket.count({ tenantId: DEMO_TENANT.id })) return;
    const employee = await tx.user.findOne({ email: "employee@demo.axis" });
    if (employee) {
      const body = "Salam! WhatsApp kanalını necə qoşa bilərik? Meta Business hesabımız var.";
      const t = await tx.supportTicket.insertOne({ tenantId: DEMO_TENANT.id, authorId: employee.id, subject: "WhatsApp qoşulması", body, priority: "MEDIUM" });
      await tx.supportTicketMessage.insertOne({ tenantId: DEMO_TENANT.id, ticketId: t.id, authorId: employee.id, body });
    }
    const month = (offset, day) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - offset, day));
    const costs = [
      ["server", "Hetzner", 9500, month(0, 2)],
      ["api", "Meta WhatsApp", 2400, month(0, 5)],
      ["server", "Hetzner", 9500, month(1, 2)],
      ["sms", "Azercell SMS", 1800, month(1, 12)],
      ["server", "Hetzner", 9500, month(2, 2)],
    ];
    await tx.platformExpense.insertMany(costs.map(([category, vendor, amount, incurredOn]) => ({ category, vendor, amount, incurredOn, note: "Demo" })));
    console.log("Demo platform: 1 ticket, 5 expenses");
  });
}

try {
  await seedPlans();
  await seedPlatformStaff(process.env.SEED_DEMO !== "false");
  if (process.env.SEED_DEMO !== "false") {
    await seedDemo();
    await seedDemoCrm();
    await seedDemoTasks();
    await seedDemoInbox();
    await seedDemoChat();
    await seedDemoPlatform();
  }
  console.log("Seed complete");
} finally {
  await client.close();
}
