# Axis — B2B SaaS CRM & Biznes İdarəetmə Platforması

> "Axis" işçi adıdır. Brend adı bir yerdə dəyişir: `apps/web/src/lib/config.ts → APP_NAME`.

Sənəd bu suallara cavab verir: **nə qururuq, necə qururuq, hansı ardıcıllıqla qururuq.**
Hər mərhələ bitəndə sonuncu bölmədəki "Status" cədvəli yenilənir.

---

## 1. Məhsul prinsipləri

1. **Bir ekran — bir iş.** Hər səhifə konkret ssenari üçündür (məs. "cavab gözləyən müştəriyə cavab ver"), statistika vitrinəsi deyil.
2. **Sadə başla, dərinə get.** Default görünüş kiçik biznes üçün; şöbələr, pipeline-lar, avtomatlaşdırma böyük şirkətdə açılır (paket + parametrlər).
3. **Saxta funksiya yoxdur.** İşləməyən düymə göstərilmir. Real API açarı olmayan inteqrasiya **"Demo"** nişanı ilə açıq işarələnir.
4. **Müştəri yazışması ≠ daxili çat.** İki ayrı modul, ayrı cədvəllər, UI-də fərqli rəng/ikon.
5. **Tenant izolyasiyası kodda və DB-də** — ikiqat qoruma (bax §4).

---

## 2. Modul və səhifə strukturu (sitemap)

### 2.1 İctimai sayt — `axis.az`
| Səhifə | Məqsəd |
|---|---|
| `/` | Landing: dəyər təklifi, modullar, CTA |
| `/pricing` | START / PRO / BUSINESS, illik endirim, FAQ |
| `/signup` | Şirkət + sahib hesabı yaradılır → 14 günlük trial |
| `/login`, `/forgot-password`, `/invite/:token` | Auth axınları |

### 2.2 Şirkət tətbiqi — `<slug>.axis.az`
| Modul | Səhifələr | Paket |
|---|---|---|
| **Dashboard** | `/dashboard` — əsas göstəricilər, gecikən işlər, son fəaliyyət | Hamısı |
| **Mesajlar (Inbox)** | `/inbox` (3 panel: söhbətlər · yazışma · müştəri kartı), `/inbox/templates` | Sayt çatı: START · Omnichannel: PRO+ |
| **CRM** | `/crm/contacts`, `/crm/contacts/:id`, `/crm/leads` | Hamısı |
| **Satışlar** | `/deals` (Kanban/siyahı), `/deals/:id`, `/deals/forecast` | Pipeline: PRO+ |
| **Tapşırıqlar** | `/tasks` (Kanban/siyahı/"Mənim işlərim"), `/tasks/:id`, `/projects/:id` | Hamısı |
| **Komanda çatı** | `/chat`, `/chat/:roomId` | Hamısı |
| **Komanda** | `/team` (işçilər), `/team/:memberId` (profil, performans, fəaliyyət), `/team/departments` | Şöbələr: BUSINESS |
| **Fayllar** | `/files` | Hamısı (limitlə) |
| **Analitika** | `/analytics/sales`, `/analytics/inbox`, `/analytics/team` | Əsas: PRO · Geniş: BUSINESS |
| **Avtomatlaşdırma** | `/automations` (trigger → şərt → əməl) | BUSINESS (Mərhələ 2) |
| **Parametrlər** | `/settings/company`, `/settings/members`, `/settings/roles`, `/settings/channels`, `/settings/pipelines`, `/settings/billing`, `/settings/security` | Hamısı |

### 2.3 Super Admin — `admin.axis.az` (ayrıca tətbiq, ayrıca auth guard)
| Səhifə | Məzmun |
|---|---|
| `/` Overview | MRR, ARR, aktiv/trial/dayandırılmış, yeni qeydiyyatlar, churn, mənfəət |
| `/tenants`, `/tenants/:id` | Şirkətlər, abunə, limitlər, istifadə, impersonate (audit ilə) |
| `/plans` | Paket/qiymət/limit/feature redaktoru |
| `/billing` | Fakturalar, ödənişlər, uğursuz ödənişlər |
| `/expenses` | API/AI/server xərcləri → mənfəət hesabı |
| `/tickets` | Dəstək müraciətləri |
| `/system` | Queue vəziyyəti, webhook xətaları, inteqrasiya sağlamlığı, bildirişlər |

---

## 3. Texnologiya stack-i və əsaslandırma

| Qat | Seçim | Niyə |
|---|---|---|
| Frontend | **Next.js 15 (App Router) + React 19 + TypeScript** | SSR/RSC ilə sürətli ilk yüklənmə, bir kod bazasında landing + app; ən geniş ekosistem |
| UI | **Tailwind CSS** + öz kiçik komponent dəsti, `lucide-react` ikonlar | Dizayn tokenləri (CSS dəyişənləri) ilə light/dark; ağır UI kitabxanası yoxdur |
| Server state | TanStack Query (Mərhələ 1-dən) | Cache, optimistic update, refetch |
| Backend | **NestJS** (modul əsaslı) | Domen modulları (crm, inbox, tasks, billing…) aydın sərhədlərlə; DI, guard, interceptor — RBAC və tenant konteksti üçün ideal |
| ORM | **Prisma** | Tip təhlükəsiz sorğular, migrasiyalar. Sxem: `packages/db/prisma/schema.prisma` |
| DB | **PostgreSQL 16** | Tranzaksiyalar, JSONB, **Row Level Security**, full-text axtarış |
| Cache/Queue | **Redis + BullMQ** | Webhook emalı, bildirişlər, təkrarlanan tapşırıqlar, billing cron, rate limit sayğacları |
| Real-time | **Socket.IO** (NestJS gateway) + Redis adapter | Inbox və komanda çatı; çox instance-da işləyir. Otaq: `tenant:<id>`, `member:<id>`, `room:<id>` |
| Fayllar | **S3-uyğun** (Cloudflare R2 / MinIO lokal) | Presigned URL ilə birbaşa yükləmə; açar: `tenants/<tenantId>/…` |
| Auth | Email+şifrə (argon2id), access JWT (15 dəq) + rotasiyalı refresh token (httpOnly cookie, DB-də hash), opsional TOTP 2FA | Öz nəzarətimizdə, tenant/rol claim-ləri ilə |
| Ödəniş | **Provider adapter** — ilk inteqrasiya Payriff və ya Epoint (AZN, yerli kartlar) | Stripe Azərbaycan şirkətlərini birbaşa dəstəkləmir; adapter sayəsində provider dəyişə bilər |
| Monitoring | Sentry (xətalar), OpenTelemetry → Grafana/Prometheus, Uptime yoxlaması | |
| Infra | Docker; başlanğıcda 1 VPS (Hetzner) + managed Postgres; sonra Kubernetes/Fly | Ucuz başla, üfüqi miqyasla |
| Backup | Postgres: gündəlik tam + WAL (PITR, 14 gün); S3 versioning | |

### 3.1 Repo strukturu (monorepo, npm workspaces)
```
apps/
  web/        Next.js — şirkət tətbiqi (+ sonra landing)
  admin/      Next.js — Super Admin (Mərhələ 4)
  api/        NestJS — REST + WebSocket gateway (Mərhələ 1)
  worker/     NestJS standalone — BullMQ prosessorları (Mərhələ 1)
packages/
  db/         Prisma sxemi, migrasiyalar, RLS SQL, seed
  shared/     Ortaq tiplər, zod sxemləri, icazə kataloqu, plan feature-ları
docs/         Bu sənəd və ADR-lər
```

### 3.2 Yüksək səviyyəli axın
```
 Browser ──HTTPS──▶ Next.js (web/admin) ──REST/WS──▶ NestJS API ──▶ PostgreSQL (RLS)
                                                   │            └─▶ Redis (cache, rate-limit, pub/sub)
 Meta/WhatsApp ──webhook──▶ API /webhooks/* ──enqueue──▶ BullMQ ──▶ Worker ──▶ DB + Socket emit
 Payment provider ─webhook─▶ API /webhooks/billing ──▶ Worker (idempotent) ──▶ Subscription state
                                                   └─▶ S3 (presigned upload/download)
```

### 3.3 Backend modulları (NestJS)
`auth` · `tenants` · `members` (rollar, dəvət) · `departments` · `crm` (contacts, activities) · `deals` (pipelines, stages, forecast) · `tasks` (projects, comments, recurrence) · `inbox` (channels, conversations, messages, templates) · `chat` · `files` · `notifications` · `analytics` (read-model sorğuları) · `billing` (plans, subscriptions, invoices, usage, entitlements) · `audit` · `admin` (platforma səviyyəsi) · `webhooks`.

Hər modul: `controller` (REST, DTO validasiya zod/class-validator) → `service` (biznes qaydaları) → `repository` (Prisma, tenant-scoped client).

---

## 4. Multi-tenant arxitektura

**Model:** paylaşılan DB, paylaşılan sxem, hər cədvəldə `tenantId`. Minlərlə kiçik şirkət üçün ən səmərəli; böyük müştəri üçün sonra ayrıca DB-yə köçürmə mümkündür (eyni sxem).

İzolyasiya 3 qatda:
1. **Routing:** `<slug>.axis.az` → API sorğusunda `tenantId` yalnız **token-dən** götürülür (URL/body-dən heç vaxt). İstifadəçinin bu tenant-da aktiv `Membership`-i yoxlanılır.
2. **Tətbiq qatı:** `TenantContext` (AsyncLocalStorage) + Prisma extension hər sorğuya avtomatik `where: { tenantId }` əlavə edir; yaradılan obyektlərə `tenantId` yazır.
3. **DB qatı:** PostgreSQL RLS (`packages/db/sql/rls.sql`). Tətbiqin DB rolu `BYPASSRLS` deyil; hər tranzaksiya `set_config('app.tenant_id', …)` ilə başlayır. Kodda filtr unudulsa belə, DB başqa tenantın sətirini qaytarmır.

Əlavə: S3 açarları tenant prefiksli, presigned URL-lər yalnız yoxlamadan sonra verilir; WebSocket otaqları tenant ID ilə; Redis açarları `t:<tenantId>:…`; audit log-da hər impersonate qeyd olunur. **Avtomatik test:** iki tenant yaradıb hər endpoint üçün çarpaz giriş cəhdi (403/404 gözlənilir) — CI-da məcburi.

---

## 5. Database modeli

Tam sxem: [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma). Əsas qruplar:

| Qrup | Cədvəllər |
|---|---|
| Platforma | `User`, `Session`, `Tenant`, `PlatformExpense`, `WebhookEvent` |
| Billing | `Plan`, `Subscription`, `Invoice`, `Payment`, `UsageCounter` |
| Təşkilat | `Membership` (user↔tenant + rol + fərdi icazələr), `Department` (iyerarxik, rəhbərli) |
| CRM | `Contact` (lead→customer lifecycle), `Pipeline`, `PipelineStage` (ehtimal %), `Deal`, `Activity` (vahid zaman xətti) |
| Tapşırıqlar | `Project`, `Task` (alt tapşırıq, RRULE təkrarlanma, CRM-ə bağlı), `TaskComment` |
| Inbox | `Channel` (şifrəli credentials), `Conversation` (`awaitingSince`, `firstResponseMs` → SLA), `Message` (`INBOUND/OUTBOUND/INTERNAL_NOTE`), `CannedResponse` |
| Komanda çatı | `ChatRoom`, `ChatMember`, `ChatMessage` (tapşırığa link) |
| Digər | `FileObject`, `Notification`, `AuditLog`, `SupportTicket` |

Qərarlar:
- **Pul** həmişə tam ədəd, qəpiklə (`3900` = 39.00 AZN) — float xətası yoxdur.
- **Lead ayrıca cədvəl deyil:** `Contact.stage = LEAD`. Kiçik biznes üçün sadə, konvertasiya = status dəyişikliyi, tarixçə itmir.
- **Soft delete** yalnız `Contact`-da (bərpa ehtiyacı); qalanlarında audit log kifayətdir.
- **Webhook idempotency:** `WebhookEvent(provider, externalId)` unikal; `Message(conversationId, externalId)` unikal.

---

## 6. Rollar və icazələr (RBAC)

4 sistem rolu + fərdi override (`Membership.permissions`, məs. `"deals.view_all"` əlavə et, `"-inbox.reply"` götür).

| İcazə | OWNER | ADMIN | MANAGER | EMPLOYEE |
|---|:-:|:-:|:-:|:-:|
| Dashboard — bütün şirkət | ✅ | ✅ | şöbə | özü |
| Müştərilər — baxış | hamısı | hamısı | şöbə | özünə təyin olunan |
| Müştəri/deal yaratmaq, redaktə | ✅ | ✅ | ✅ | özününkü |
| Deal silmək / export | ✅ | ✅ | ❌ | ❌ |
| Inbox — cavab vermək | ✅ | ✅ | ✅ | təyin olunan |
| Inbox — təyin/yönləndirmə | ✅ | ✅ | ✅ | ❌ |
| Tapşırıq vermək | ✅ | ✅ | şöbəyə | özünə/həmkara |
| İşçi dəvəti, rol dəyişmək | ✅ | ✅ | ❌ | ❌ |
| Kanal inteqrasiyası | ✅ | ✅ | ❌ | ❌ |
| Billing, paket dəyişmək | ✅ | ❌ | ❌ | ❌ |
| Analitika — tam | ✅ | ✅ | şöbə | ❌ |
| Audit log | ✅ | ✅ | ❌ | ❌ |

Platforma rolları (`User.platformRole`): `SUPER_ADMIN` (hər şey), `SUPPORT` (oxumaq + impersonate, billing redaktə yox).

İcra: NestJS `@RequirePermission('deals.update')` guard + **data scope** (`all | department | own`) servis qatında sorğuya filtr kimi tətbiq olunur. Frontend eyni kataloqdan (`packages/shared/permissions.ts`) menyunu və düymələri gizlədir — amma qərarı həmişə backend verir.

---

## 7. Vahid mesaj mərkəzi (Omnichannel)

| Kanal | Rəsmi API | MVP-də |
|---|---|---|
| Vebsayt çatı | Öz widget-imiz (JS snippet + WebSocket) | ✅ Real |
| WhatsApp | WhatsApp Business **Cloud API** (Meta) — Embedded Signup | Açar varsa real, yoxdursa **Demo** |
| Instagram Direct | Instagram Messaging API (Meta Graph) | eyni |
| Facebook Messenger | Messenger Platform (Meta Graph) | eyni |
| Email | IMAP/SMTP və ya Gmail/Outlook API | Mərhələ 3 |

Axın: webhook → imza yoxlaması (`X-Hub-Signature-256`) → `WebhookEvent` (idempotent) → queue → normalizə (`Conversation`/`Message`) → kontakt telefon/ID ilə tapılır və ya yaradılır → `awaitingSince` qoyulur → socket emit → bildiriş.
Cavab: UI-də iki aydın rejim — **"Müştəriyə cavab"** (mavi) və **"Daxili qeyd"** (sarı, `INTERNAL_NOTE`, heç vaxt göndərilmir). WhatsApp-ın 24 saat pəncərəsi bağlıdırsa yalnız təsdiqlənmiş şablon göndərmək təklif olunur.
Metriklər: ilk cavab müddəti, orta cavab müddəti, cavab gözləyən söhbət sayı — işçi və kanal üzrə.

**Demo rejimi:** kanal "Demo" nişanlıdır, gələn mesajlar simulyatordan gəlir, göndərilən mesaj xarici xidmətə getmir və bu UI-də yazılır.

---

## 8. Abunəlik sistemi

### 8.1 Paketlər (Super Admin redaktə edir — `Plan` cədvəli)
| | START | PRO | BUSINESS |
|---|---|---|---|
| Qiymət | 39 AZN/ay | 99 AZN/ay | 199 AZN/ay |
| İşçi | 3 | 10 | 25 |
| Feature | CRM (sadə), tapşırıqlar, komanda çatı, sayt çatı | + omnichannel, pipeline, işçi nəzarəti, əsas analitika | + avtomatlaşdırma, geniş analitika, şöbələr, prioritet dəstək |

Əlavələr (add-on): işçi yeri, yaddaş, AI kreditləri, əlavə inteqrasiya, premium avtomatlaşdırma → `Subscription.extraSeats/extraStorageMb` + `UsageCounter`.

### 8.2 Status maşını
```
signup ─▶ TRIALING (14 gün, PRO feature-ları)
TRIALING ── ödəniş ─▶ ACTIVE
TRIALING ── trial bitdi, ödəniş yox ─▶ SUSPENDED (yalnız oxumaq + billing səhifəsi)
ACTIVE ── ödəniş uğursuz ─▶ PAST_DUE (7 gün grace, 1/3/5-ci gün təkrar cəhd + email)
PAST_DUE ── ödəniş ─▶ ACTIVE
PAST_DUE ── grace bitdi ─▶ SUSPENDED
SUSPENDED ── 90 gün ─▶ CANCELED (data export imkanı, sonra silinmə)
```
- **Upgrade:** dərhal, qalan günlər üçün proporsional (proration) faktura.
- **Downgrade:** dövrün sonunda (`scheduledPlanId`). Limit aşılırsa (məs. 8 işçi → START 3), downgrade-dən əvvəl hansı işçilərin deaktiv olacağını seçmək tələb olunur.
- **Limitlər:** `EntitlementService.check(tenant, 'seats')` — dəvət, fayl yükləmə, kanal qoşma əməliyyatlarında; aşılanda UI aydın mesaj + "Paketi yüksəlt" göstərir, data heç vaxt silinmir.
- Ödəniş webhook-ları idempotent; faktura nömrəsi ardıcıl; bütün dəyişikliklər audit log-da.

---

## 9. Təhlükəsizlik

- argon2id şifrə, refresh token rotasiyası + reuse detection, 2FA (TOTP), login rate limit + brute-force lock
- Rate limiting: Redis sliding window — IP üzrə və tenant üzrə (`@nestjs/throttler` + Redis storage)
- Input validasiya hər endpoint-də (zod), output DTO-ları (credentials heç vaxt qaytarılmır)
- Kanal credentials AES-256-GCM ilə şifrələnir (açar KMS/env-də)
- CSP, HSTS, SameSite cookie, CSRF (cookie auth endpoint-ləri üçün)
- Audit log: rol dəyişikliyi, export, silmə, billing, impersonate, login
- Fayl yükləmə: MIME/ölçü yoxlaması, antivirus skan (ClamAV, Mərhələ 3)
- OWASP ASVS L2 checklist, asılılıq skanı (Dependabot/`npm audit`) CI-da

---

## 10. MVP sərhədləri

**MVP-yə daxildir (öz şirkətində istifadə + ilk 10–20 ödənişli müştəri):**
- Qeydiyyat, login, dəvət, 4 rol, şirkət parametrləri
- Dashboard
- CRM: kontaktlar, lead→müştəri, deal Kanban (1 pipeline), qeydlər, zaman xətti
- Inbox: sayt çatı (real) + WhatsApp Cloud API (real, açar ilə) + IG/Messenger (açar varsa real, yoxsa demo), təyin etmə, daxili qeyd, şablonlar, cavab müddəti
- Tapşırıqlar: CRUD, məsul, son tarix, prioritet, status, alt tapşırıq, şərh, fayl, Kanban/siyahı, gecikmə bildirişi
- Komanda çatı: şəxsi + şöbə qrupu, fayl
- Billing: trial, 3 paket, bir ödəniş provayderi, limitlər, upgrade/downgrade
- Super Admin: şirkətlər, abunəliklər, paket redaktoru, ödənişlər, MRR
- AZ/EN/RU, light/dark, mobil uyğun

**MVP-dən sonra:** avtomatlaşdırma qurucusu, AI (cavab təklifi, xülasə), geniş analitika, çoxlu pipeline, təkrarlanan tapşırıqlar UI-si, email kanalı, mobil tətbiq, public API + Zapier/n8n, add-on mağazası.

---

## 11. Development planı

| Mərhələ | Məzmun | Nəticə |
|---|---|---|
| **0. Fundament** | Monorepo, DB sxemi, dizayn sistemi, app shell, i18n, tema, **Dashboard (demo data)** | ← *bu addım* |
| **1. Core backend** | NestJS API, auth, tenant konteksti + RLS, members/rollar/dəvət, Docker Compose (Postgres, Redis, MinIO), seed, CI | Real login, real tenant |
| **2. CRM + Satışlar** | Kontaktlar, kart, zaman xətti, deal Kanban (drag&drop), lost reason, forecast; Dashboard real API-yə keçir | |
| **3. Tapşırıqlar + Komanda** | Tasks/projects, şərh, fayl (S3), bildirişlər, gecikmə job-u; işçi profili və performans | |
| **4. Inbox** | Sayt çatı widget, WebSocket, WhatsApp/IG/Messenger adapterləri + demo simulyator, şablonlar, SLA metrikləri | |
| **5. Komanda çatı** | Otaqlar, real-time, axtarış, tapşırıq linki | |
| **6. Billing** | Plan/entitlement servisi, trial/grace job-ları, ödəniş adapteri, faktura | Satışa hazır |
| **7. Super Admin** | `apps/admin`, tenant idarəsi, plan redaktoru, gəlir/xərc/mənfəət, tiketlər, sistem sağlamlığı | |
| **8. Sonrakı** | Avtomatlaşdırma, AI, geniş analitika, email kanalı | |

Hər mərhələnin sonunda: tiplər yoxlanır, unit + e2e testlər (Playwright), tenant izolyasiya testi (Mərhələ 1-dən), bu sənəddə Status yenilənir.

---

## 12. Status

### Mərhələ 0 — Fundament ✅
| Hissə | Vəziyyət | Qeyd |
|---|---|---|
| Arxitektura sənədi, DB sxemi | ✅ | |
| Web shell (sidebar, tema, AZ/EN/RU), Dashboard | ✅ | Dashboard rəqəmləri **demo** (`apps/web/src/lib/api/demo-data.ts`) |

### Mərhələ 1 — Core backend ✅
| Hissə | Vəziyyət | Harada |
|---|---|---|
| Lokal PostgreSQL 17 (Docker-siz) + migrasiya + seed | ✅ | `npm run db:start` → `packages/db/scripts/dev-db.mjs`; alternativ `docker-compose.yml` |
| RLS (tenant izolyasiyası DB səviyyəsində) | ✅ | `packages/db/prisma/migrations/*_rls`; tətbiq `axis_app` rolu ilə qoşulur (owner deyil, BYPASSRLS yoxdur) |
| Auth: qeydiyyat (şirkət + sahib + 14 gün PRO trial + default pipeline), login, refresh rotasiyası + oğurluq aşkarlanması, logout, şirkət dəyişmə | ✅ | `apps/api/src/auth` |
| Şifrələr argon2id; access JWT 15 dəq; refresh 30 gün (DB-də sha256) | ✅ | |
| Rol + icazə kataloqu (API və web eyni mənbədən) | ✅ | `packages/shared/src/permissions.ts` |
| İşçilər: siyahı, dəvət (link), rol/şöbə/status dəyişmə, owner qorumaları, yer limiti | ✅ | `apps/api/src/members` |
| Şöbələr CRUD | ✅ | `apps/api/src/departments` (UI: əlavə et/sil; adını dəyişmə UI-si sonra) |
| Audit log (yazılır + API) | ✅ | `GET /v1/audit-logs`; UI hələ yoxdur |
| Rate limit (auth endpoint-ləri, IP üzrə) | ✅ | yaddaşda; çox instance üçün Redis-ə keçəcək |
| Web: login, qeydiyyat, dəvət qəbulu, avtomatik token yenilənməsi, BFF proxy (CSRF yoxlaması), İşçilər səhifəsi | ✅ | tokenlər httpOnly cookie-də, brauzer JS-i onları görmür |
| Email göndərişi (dəvət) | ⏳ **yoxdur** | dəvət linki UI-də göstərilir, işçiyə əl ilə göndərilir |
| Paket feature-larına görə bloklama (məs. şöbələr yalnız BUSINESS) | ⏳ | Mərhələ 6 (billing) — hazırda yalnız işçi limiti tətbiq olunur |
| 2FA, şifrə bərpası, email təsdiqi | ⏳ | email servisi ilə birlikdə |

**Testlər:** 28 API e2e (real Postgres, hər icrada təmiz baza) + 6 web unit. Əsas yoxlananlar: iki şirkət arasında çarpaz giriş cəhdləri (404), RLS-in API-dən kənarda birbaşa SQL ilə yoxlanması, hər `tenantId` cədvəlində RLS-in aktiv olması, refresh token təkrar istifadəsində bütün ailənin ləğvi, deaktiv işçinin sessiyasının dərhal bitməsi, iki sahibin eyni anda bir-birini endirməsi (şirkət sahibsiz qalmır), yer limiti, rate limit.

### Mərhələ 2 — CRM + Satışlar ✅
| Hissə | Vəziyyət | Harada |
|---|---|---|
| Müştərilər: siyahı (axtarış ad/email/telefon/şirkət, status və məsul filtri, səhifələmə), yaratma, redaktə, soft delete | ✅ | `apps/api/src/crm/contacts.*`, `/crm`, `/crm/new`, `/crm/[id]` |
| Lead → Kvalifikasiya → Müştəri → İtirilmiş; satış qazanılanda müştəri avtomatik "Müştəri" olur | ✅ | |
| Qeydlər və vahid zaman xətti (müştəri, satış, Dashboard eyni mənbədən) | ✅ | `Activity` cədvəli; adlar yazılma anında saxlanılır |
| Satış pipeline-ı: Kanban (sürüşdür-burax + hər kartda mərhələ seçimi — klaviatura/mobil), itirmə səbəbi məcburi, bağlanmış satışlar 30 gün lövhədə | ✅ | `/deals`, `/deals/[id]` |
| Proqnoz: açıq məbləğ, ehtimalla çəkili proqnoz, bu ay qazanılan/itirilən + səbəblər | ✅ | `GET /v1/deals/forecast` |
| Görünmə sahəsi: Sahib/Admin hamısı · Rəhbər öz şöbəsi + təyin olunmamışlar · İşçi yalnız özününkü; başqasına təyin etmək yalnız Rəhbər+ | ✅ | `apps/api/src/crm/scope.ts` |
| Dashboard real API-də (yeni müştərilər, aktiv satışlar, satış məbləği, dinamika, işçi performansı, fəaliyyət) | ✅ | `GET /v1/dashboard`; tarixlər şirkətin saat qurşağında |
| Mesajlar və tapşırıqlar panelləri (Dashboard) | 🟡 **Demo** | ayrıca "Demo" nişanı ilə; Mərhələ 3–4 |
| Xatırlatmalar | ⏳ | Tapşırıqlar modulu ilə (Mərhələ 3) |
| Müştəri kartından mesaj yazmaq | ⏳ | Inbox ilə (Mərhələ 4) |
| Bir neçə pipeline, mərhələləri redaktə etmək | ⏳ | sxem hazırdır, UI sonra |
| Silinmiş müştərini bərpa etmək (UI) | ⏳ | məlumat saxlanılır (`deletedAt`) |

**Bu mərhələdə tapılıb düzəldilənlər:**
- BFF arxasında API bütün istifadəçiləri bir IP kimi görürdü → rate limit bütün platforma üçün ortaq olardı. İndi web real müştəri IP-sini ötürür, API ona yalnız etibarlı proksidən inanır (`TRUST_PROXY`).
- Bir sorğuda yazılan hadisələrin vaxtı eyni olduğundan zaman xəttinin sırası təsadüfi idi → monoton vaxt + ikinci sıralama açarı.
- Kanban sütunları sabit enli idi və 1400px konteynerə sığmırdı → elastik sütunlar.

**Testlər:** 43 API e2e (o cümlədən 14 CRM: rollar üzrə görünmə, çarpaz şirkət, Kanban qaydaları, proqnoz, Dashboard rəqəmlərinin bir-biri ilə uyğunluğu) + 7 web unit + 4 Playwright UI ssenarisi (qeydiyyat → müştəri → qeyd → satış → Kanban sürüşdürmə → qazanılan → Dashboard; itirmə dialoqu; dəvət olunan işçinin məhdud görünüşü; dil və çıxış).

### Mərhələ 3 — Tapşırıqlar + Komanda ✅
| Hissə | Vəziyyət | Harada |
|---|---|---|
| Tapşırıqlar: məsul, son tarix (şirkətin saat qurşağında), prioritet, status, təsvir, layihə, siyahı və lövhə (sürüşdürmə + seçim), bir kliklə tamamlama, axtarış, "Mənim / Yaratdığım / Hamısı / Gecikmiş" | ✅ | `apps/api/src/tasks`, `/tasks`, `/tasks/[id]` |
| Alt tapşırıqlar (1 səviyyə), şərhlər, təkrarlanan tapşırıqlar (gündəlik / həftəlik / 2 həftə / aylıq — tamamlananda növbəti yaranır) | ✅ | |
| Müştəri/satışa bağlı tapşırıq = xatırlatma; müştəri kartında "Tapşırıqlar və xatırlatmalar" | ✅ | |
| Görünmə: Sahib/Admin hamısı · Rəhbər öz şöbəsinin (məsul və ya yaradan) · İşçi özününkü; təyin etmə: Rəhbər+ hər kəsə, İşçi özünə və şöbə həmkarına | ✅ | `taskScope()`; yeni icazə `tasks.view_all` |
| Fayllar: yükləmə (10 MB), endirmə (həmişə "attachment", `nosniff`, `sandbox`), silmə, paket yaddaş limiti | ✅ lokal disk | `apps/api/src/storage` — **S3 adapteri yazılmayıb** (interfeys hazırdır; deploy mərhələsində) |
| Bildirişlər: təyin olunma, şərh, tamamlanma, gecikmə; zəng ikonu, oxundu/hamısını oxu | ✅ | `apps/api/src/notifications` |
| Gecikmə bildirişi fon prosesi (5 dəq): hər tapşırıq üçün bir dəfə, bir neçə API instansında da təkrarlanmır; son tarix dəyişəndə yenidən aktivləşir | ✅ | `tasks/overdue.job.ts` + DB funksiyası `tasks_due_for_overdue_notice` (yalnız id qaytarır) |
| Komanda: işçi kartları (açıq/gecikən/tamamlanan tapşırıq, satış, məbləğ, açıq satış, dövr filtri), işçi profili (cari tapşırıqlar, fəaliyyət) | ✅ | `/team`, `/team/[id]` |
| Dashboard: tapşırıq KPI və gecikmiş tapşırıqlar paneli real; işçi cədvəlində tamamlanan/gecikən | ✅ | demo yalnız Mesajlar üçün qalır |
| E-poçt/push bildirişləri, ümumi "Fayllar" səhifəsi, tapşırıq şablonları | ⏳ | sonra |

**Bu mərhələdə tapılıb düzəldilənlər:**
- Yeni icazə əlavə edilərkən skript səhvən onu Rəhbər roluna da yazmışdı → Rəhbər bütün şirkətin tapşırıqlarını görərdi. Test tutdu; düzəldildi və rol matrisi indi ayrıca testlə sabitlənib (`test/permissions.e2e-spec.ts`).
- Azərbaycan hərfli fayl adları ("müqavilə") yükləmədə korlanırdı (multipart adları latin1 kimi oxunurdu) → UTF-8 bərpası.
- Tapşırıq silinəndə faylları diskdə yetim qalırdı → qeydlər tranzaksiyada, bloblar commit-dən sonra silinir.

**Testlər:** 54 API e2e + 5 rol matrisi + 8 web unit + 7 Playwright UI ssenarisi (o cümlədən tapşırıq → lövhə → alt tapşırıq → şərh → fayl yükləmə/endirmə; bildiriş zəngi ilə təyin olunma; müştəri xatırlatması).

### Mərhələ 4 — Vahid mesaj mərkəzi ✅
| Hissə | Vəziyyət | Harada |
|---|---|---|
| Sayt çatı: `<script src=".../widget.js">` ilə istənilən sayta qoşulur, iframe-də işləyir (sahib saytı yazışmanı və cookie-ləri görmür), ziyarətçi tokeni yalnız hash kimi saxlanılır | ✅ **real** | `public/widget.js`, `/widget/[key]`, `apps/api/src/inbox/widget.controller.ts` |
| WhatsApp Cloud API, Messenger, Instagram: rəsmi Graph endpoint-ləri, `X-Hub-Signature-256` yoxlaması, idempotent webhook, çatdırılma statusları, WhatsApp 24 saat pəncərəsi | ✅ kod + testlər | **Real Meta-ya qarşı yoxlanmayıb** — testlər lokal saxta Graph serverinə qarşıdır. Real qoşulma üçün Meta tətbiqi, `META_APP_SECRET`, `META_VERIFY_TOKEN` və ictimai HTTPS API ünvanı lazımdır |
| Access token-lər AES-256-GCM ilə şifrəli (`CHANNEL_SECRET_KEY`), API heç vaxt qaytarmır | ✅ | `inbox/secrets.ts` |
| Demo kanallar: açarsız, "Demo" nişanlı, heç nə göndərilmir, gələn mesaj simulyatoru | ✅ | Parametrlər → Kanallar |
| Mesaj mərkəzi: 3 panel, status (Açıq/Gözləmədə/Həll edilib), "Mənim/Təyin olunmayıb", axtarış, oxunmamış sayı, gözləmə müddəti | ✅ | `/inbox` |
| "Müştəriyə cavab" ↔ "Daxili qeyd" aydın ayrımı (fərqli rəng; qeyd heç vaxt müştəriyə/widget-ə getmir) | ✅ | testlə təsdiqlənib |
| Təyin etmə, şöbəyə yönləndirmə, ilk cavabda avtomatik təyin, müştəri yenidən yazanda avtomatik açılma | ✅ | |
| CRM-ə əlavə etmə; telefon/email üzrə avtomatik müştəri tanıma; müştəri kartında yazışmalar | ✅ | |
| Hazır cavablar (siyahıdan və ya `/qısayol` + boşluq) | ✅ | |
| Real vaxt: SSE axını (`/v1/inbox/stream`), agent ekranı yenilənmədən dəyişir | ✅ | tək API instansı üçün; çoxlu instansda Redis pub/sub lazımdır |
| Cavab müddəti metrikləri (ümumi, işçi, kanal) → Dashboard və işçi cədvəli | ✅ | demo məlumat modulu **tam silindi** |
| Görünmə: Sahib/Admin hamısı · Rəhbər öz şöbəsi + təyin olunmamışlar · İşçi yalnız ona təyin olunanlar | ✅ | `inboxScope()`; yeni icazə `inbox.view_all` |
| WhatsApp şablon mesajları (24 saatdan sonra yazmaq), media fayllar, email kanalı | ⏳ | sonra |

**Bu mərhələdə tapılıb düzəldilənlər:**
- `useEffect(() => el.scrollIntoView())` kimi qısa effektlər Chrome-un yeni versiyalarında (scroll metodları Promise qaytarır) səhifəni çökdürürdü — widget və yazışma ekranı dahil 7 yerdə düzəldildi.
- Sidebar sayğacları real olduqdan sonra keçid adları dəyişdi — test köməkçisi buna uyğunlaşdırıldı.

**Testlər:** 73 API e2e (o cümlədən 14 inbox: widget izolyasiyası, daxili qeydin ziyarətçiyə getməməsi, webhook imzası və təkrarlar, Graph API sorğu formatı, 24 saat pəncərəsi, demo kanal, marşrutlama, CRM bağlantısı, metriklər, SSE) + 8 web unit + 10 Playwright UI (başqa saytda yerləşdirilmiş widget → real vaxt inbox → cavab + qeyd → ziyarətçi yalnız cavabı görür).

### Növbəti — Mərhələ 5: Komanda çatı
Şəxsi və şöbə çatları, real vaxt, fayl göndərmə, axtarış, tapşırıqla əlaqələndirmə.
