# Axis — B2B SaaS CRM platforması

Arxitektura, modullar, DB modeli, rollar, MVP, plan və **hər mərhələnin statusu**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## İşə salmaq (lokal)

Node.js 20.11+ lazımdır. Docker **lazım deyil**.

```bash
cp .env.example .env     # bir dəfə
npm install              # bir dəfə

npm run db:start         # Terminal 1: PostgreSQL (.data/pg), migrasiya + seed. Açıq saxlayın.
npm run dev              # Terminal 2: API http://localhost:4000 + web http://localhost:3000
```

Demo hesablar (şifrə `demo12345`): `owner@demo.axis`, `admin@demo.axis`, `manager@demo.axis`, `employee@demo.axis`.
Və ya `/signup` səhifəsində öz şirkətinizi yaradın.

Docker varsa `npm run db:start` əvəzinə: `docker compose up -d postgres && npm run db:migrate && npm run db:seed`.

## Əmrlər

```bash
npm test             # web unit + API e2e (öz müvəqqəti Postgres-ini qaldırır)
npm run typecheck
npm run build
npm run db:migrate   # yeni migrasiyaları tətbiq et
```

## Struktur

```
apps/api/        NestJS — REST API (auth, members, departments, audit)
apps/web/        Next.js 15 — şirkət tətbiqi (BFF: tokenlər httpOnly cookie-də)
packages/shared/ İcazə kataloqu, zod sxemləri, API tipləri (API və web üçün ortaq)
packages/db/     Prisma sxemi, migrasiyalar (RLS daxil), seed, lokal Postgres skripti
docs/            Arxitektura sənədi
```
