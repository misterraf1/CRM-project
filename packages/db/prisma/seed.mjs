import "../scripts/load-env.mjs";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";

// Idempotent: safe to run on every `npm run db:start`.
// Plans always; the demo workspace only when SEED_DEMO !== "false".

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

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
const DEMO_TENANT = { id: "tenant_demo", slug: "demo", name: "Demo Şirkət MMC" };
const DEMO_MEMBERS = [
  { email: "owner@demo.axis", fullName: "Kamran Əliyev", role: "OWNER", title: "Direktor" },
  { email: "admin@demo.axis", fullName: "Aysel Hüseynova", role: "ADMIN", title: "Ofis meneceri" },
  { email: "manager@demo.axis", fullName: "Tural Məmmədov", role: "MANAGER", title: "Satış rəhbəri" },
  { email: "employee@demo.axis", fullName: "Nigar Qasımova", role: "EMPLOYEE", title: "Satış meneceri" },
];

async function seedPlans() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({ where: { code: plan.code }, create: plan, update: {} });
  }
}

async function seedDemo() {
  const passwordHash = await hash(DEMO_PASSWORD);
  const pro = await prisma.plan.findUniqueOrThrow({ where: { code: "PRO" } });
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${DEMO_TENANT.id}, true)`;
    if (await tx.tenant.findUnique({ where: { id: DEMO_TENANT.id } })) return;

    await tx.tenant.create({ data: { ...DEMO_TENANT, status: "TRIALING" } });
    await tx.subscription.create({
      data: {
        tenantId: DEMO_TENANT.id,
        planId: pro.id,
        status: "TRIALING",
        trialEndsAt: new Date(now.getTime() + 14 * 86400_000),
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 14 * 86400_000),
      },
    });
    const sales = await tx.department.create({ data: { tenantId: DEMO_TENANT.id, name: "Satış" } });
    for (const m of DEMO_MEMBERS) {
      const user = await tx.user.upsert({
        where: { email: m.email },
        create: { email: m.email, fullName: m.fullName, passwordHash, emailVerified: now },
        update: {},
      });
      await tx.membership.create({
        data: {
          tenantId: DEMO_TENANT.id,
          userId: user.id,
          role: m.role,
          status: "ACTIVE",
          title: m.title,
          departmentId: m.role === "MANAGER" || m.role === "EMPLOYEE" ? sales.id : null,
          joinedAt: now,
        },
      });
    }
    console.log(`Demo workspace: ${DEMO_MEMBERS.map((m) => m.email).join(", ")} / ${DEMO_PASSWORD}`);
  });
}

try {
  await seedPlans();
  if (process.env.SEED_DEMO !== "false") await seedDemo();
  console.log("Seed complete");
} finally {
  await prisma.$disconnect();
}
