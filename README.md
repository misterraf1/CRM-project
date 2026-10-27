# Axis — B2B SaaS CRM platforması

Arxitektura, modullar, DB modeli, rollar, MVP, plan və **hər mərhələnin statusu**: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## İşə salmaq (lokal)

Node.js 20.11+ lazımdır. Docker **lazım deyil**.

```bash
cp .env.example .env     # bir dəfə
npm install              # bir dəfə

npm run db:start         # Terminal 1: MongoDB replica set (.data/mongo), indekslər + seed. Açıq saxlayın.
npm run dev              # Terminal 2: tətbiq http://localhost:3000 (backend eyni Next.js prosesindədir)
```

Demo hesablar (şifrə `demo12345`): `owner@demo.axis`, `admin@demo.axis`, `manager@demo.axis`, `employee@demo.axis`.
Və ya `/signup` səhifəsində öz şirkətinizi yaradın.

Docker varsa `npm run db:start` əvəzinə: `docker compose up -d mongo && npm run db:indexes && npm run db:seed`.

## Mesaj kanalları

- **Sayt çatı** dərhal işləyir: Parametrlər → Kanallar → "Sayt çatı", verilən kodu saytınıza əlavə edin.
- **WhatsApp / Instagram / Messenger**: Meta tətbiqi lazımdır. `.env`-də `META_APP_SECRET`, `META_VERIFY_TOKEN`
  təyin edin, Meta-da webhook ünvanını `https://<domain>/v1/webhooks/meta` göstərin. Açarlar olmadan "Demo"
  kanal yaradıb simulyatorla sınaqdan keçirə bilərsiniz.

## Əmrlər

```bash
npm test             # unit + API e2e (öz müvəqqəti MongoDB replica set-ini qaldırır)
npm run test:ui      # Playwright UI testləri (db:start + dev işləyərkən; sistemdəki Chrome ilə)
npm run typecheck
npm run build
npm run db:indexes   # MongoDB indekslərini yarat/yenilə (scripts/db/indexes.mjs)
```

## Struktur

Tək Next.js 15 layihəsi — frontend və backend bir yerdə:

```
src/app/         Səhifələr və route handler-lər (BFF proxy /api/v1, /api/admin; webhook-lar /v1/webhooks; /health; /api/cron)
src/components/  UI komponentləri
src/lib/         Web köməkçiləri; lib/api/internal.ts backend-i prosesdaxili çağırır
src/server/      Backend: servislər (biznes qaydaları), route cədvəli (*.routes.ts), guard-lar, fon prosesləri
src/shared/      İcazə kataloqu, zod sxemləri, API tipləri (`@/shared`)
scripts/db/      Lokal MongoDB, indekslər, backfill, seed
test/            API e2e testləri (jest)
e2e/             Playwright UI testləri
docs/            Arxitektura sənədi
```
