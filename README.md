# Axis — B2B SaaS CRM platforması

Arxitektura, modullar, DB modeli, rollar, MVP, plan və **hər mərhələnin statusu**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## İşə salmaq (lokal)

Node.js 20.11+ lazımdır. Docker **lazım deyil**.

```bash
cp .env.example .env     # bir dəfə
npm install              # bir dəfə

npm run db:start         # Terminal 1: MongoDB replica set (.data/mongo), indekslər + seed. Açıq saxlayın.
npm run dev              # Terminal 2: API http://localhost:4000 + web http://localhost:3000
```

Demo hesablar (şifrə `demo12345`): `owner@demo.axis`, `admin@demo.axis`, `manager@demo.axis`, `employee@demo.axis`.
Və ya `/signup` səhifəsində öz şirkətinizi yaradın.

Docker varsa `npm run db:start` əvəzinə: `docker compose up -d mongo && npm run db:indexes && npm run db:seed`.

## Mesaj kanalları

- **Sayt çatı** dərhal işləyir: Parametrlər → Kanallar → "Sayt çatı", verilən kodu saytınıza əlavə edin.
- **WhatsApp / Instagram / Messenger**: Meta tətbiqi lazımdır. `.env`-də `META_APP_SECRET`, `META_VERIFY_TOKEN`
  təyin edin, Meta-da webhook ünvanını `https://<api-domain>/v1/webhooks/meta` göstərin. Açarlar olmadan "Demo"
  kanal yaradıb simulyatorla sınaqdan keçirə bilərsiniz.

## Əmrlər

```bash
npm test             # web unit + API e2e (öz müvəqqəti MongoDB replica set-ini qaldırır)
npm run test:ui -w @axis/web   # Playwright UI testləri (db:start + dev işləyərkən; sistemdəki Chrome ilə)
npm run typecheck
npm run build
npm run db:indexes   # MongoDB indekslərini yarat/yenilə (packages/db/scripts/indexes.mjs)
```

## Struktur

```
apps/api/        NestJS — REST API (auth, members, departments, audit)
apps/web/        Next.js 15 — şirkət tətbiqi (BFF: tokenlər httpOnly cookie-də)
packages/shared/ İcazə kataloqu, zod sxemləri, API tipləri (API və web üçün ortaq)
packages/db/     Prisma sxemi (MongoDB), indekslər, null-fill, seed, lokal MongoDB skripti
docs/            Arxitektura sənədi
```
