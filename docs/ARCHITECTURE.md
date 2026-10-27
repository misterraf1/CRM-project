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

### 2.3 Super Admin — `/admin` (ayrıca sessiya, ayrıca token issuer, ayrıca guard)

> **Qərar (Mərhələ 7):** ayrıca Next tətbiqi əvəzinə `apps/web` daxilində `/admin` altında qurulub. Səbəb: i18n, tema və UI komponentləri təkrarlanmır. Təhlükəsizlik sərhədi isə tətbiqin özündə deyil, sessiyadadır: ayrıca cookie (`axis_adm`, `SameSite=Strict`), ayrıca JWT issuer (`axis-admin`), hər sorğuda yoxlanan `AdminSession`. Şirkət tokeni admin API-də, admin tokeni şirkət API-də işləmir (e2e testlə yoxlanır). Production-da `admin.axis.az` domeni middleware-də host üzrə `/admin`-ə yönləndiriləcək.

| Səhifə | Məzmun |
|---|---|
| `/` Overview | MRR, ARR, aktiv/trial/dayandırılmış, yeni qeydiyyatlar, churn, mənfəət |
| `/tenants`, `/tenants/:id` | Şirkətlər, abunə, limitlər, istifadə; sınağı uzatmaq, dayandırmaq / bərpa (audit ilə). Impersonate — ⏳ |
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
| ORM | **Prisma 5** (MongoDB konnektoru) | Tip təhlükəsiz sorğular. Sxem: `packages/db/prisma/schema.prisma`; indekslər `packages/db/scripts/indexes.mjs` |
| DB | **MongoDB 7** (replica set) | Sahibin qərarı ilə (2026-10-23) PostgreSQL-dən köçürüldü. Tranzaksiyalar üçün replica set məcburidir. Tenant izolyasiyası bazada deyil, API-dəki tenant qoruyucusundadır (§4) |
| Cache/Queue | **Redis + BullMQ** | Webhook emalı, bildirişlər, təkrarlanan tapşırıqlar, billing cron, rate limit sayğacları |
| Real-time | **Socket.IO** (NestJS gateway) + Redis adapter | Inbox və komanda çatı; çox instance-da işləyir. Otaq: `tenant:<id>`, `member:<id>`, `room:<id>` |
| Fayllar | **S3-uyğun** (Cloudflare R2 / MinIO lokal) | Presigned URL ilə birbaşa yükləmə; açar: `tenants/<tenantId>/…` |
| Auth | Email+şifrə (argon2id), access JWT (15 dəq) + rotasiyalı refresh token (httpOnly cookie, DB-də hash), opsional TOTP 2FA | Öz nəzarətimizdə, tenant/rol claim-ləri ilə |
| Ödəniş | **Provider adapter** — ilk inteqrasiya Payriff və ya Epoint (AZN, yerli kartlar) | Stripe Azərbaycan şirkətlərini birbaşa dəstəkləmir; adapter sayəsində provider dəyişə bilər |
| Monitoring | Sentry (xətalar), OpenTelemetry → Grafana/Prometheus, Uptime yoxlaması | |
| Infra | Docker; başlanğıcda 1 VPS (Hetzner) + MongoDB Atlas (və ya öz replica set-imiz); sonra Kubernetes/Fly | Ucuz başla, üfüqi miqyasla |
| Backup | MongoDB: Atlas continuous backup / PITR (14 gün) və ya `mongodump` + oplog; S3 versioning | |

### 3.1 Repo strukturu (monorepo, npm workspaces)
```
apps/
  web/        Next.js — şirkət tətbiqi (+ sonra landing)
  admin/      Next.js — Super Admin (Mərhələ 4)
  api/        NestJS — REST + WebSocket gateway (Mərhələ 1)
  worker/     NestJS standalone — BullMQ prosessorları (Mərhələ 1)
packages/
  db/         Prisma sxemi (MongoDB), indekslər, null-fill, seed, lokal MongoDB skripti
  shared/     Ortaq tiplər, zod sxemləri, icazə kataloqu, plan feature-ları
docs/         Bu sənəd və ADR-lər
```

### 3.2 Yüksək səviyyəli axın
```
 Browser ──HTTPS──▶ Next.js (web/admin) ──REST/WS──▶ NestJS API ──tenant guard──▶ MongoDB
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
3. **Tenant qoruyucusu (MongoDB-də RLS yoxdur):** bütün Prisma sorğuları `apps/api/src/prisma/tenant-guard.ts`-dən keçir. `tenantId` sahəsi olan hər modeldə oxuma cari şirkətə daraldılır, update/delete yalnız cari şirkətdə işləyir, başqa şirkətə create və `tenantId`-nin dəyişdirilməsi rədd edilir, kontekst olmadıqda heç nə qaytarılmır. Modellər siyahısı sxemdən avtomatik çıxarılır (yeni model unudula bilməz — testlə yoxlanır). Şirkətlərarası platforma əməliyyatları (webhook, fon prosesləri, slug yoxlaması) yalnız açıq `PrismaService.system()` ilə.
   **PostgreSQL RLS-dən fərqi:** qoruma bazada deyil, prosesdədir — bazaya başqa yoldan (məs. `mongosh`, BI aləti) qoşulan bu qorumanı keçmir. Ona görə production-da baza istifadəçisinin hüquqları minimal saxlanılmalı və bazaya birbaşa giriş məhdudlaşdırılmalıdır.

Əlavə: S3 açarları tenant prefiksli, presigned URL-lər yalnız yoxlamadan sonra verilir; WebSocket otaqları tenant ID ilə; Redis açarları `t:<tenantId>:…`; audit log-da hər impersonate qeyd olunur. **Avtomatik test:** iki tenant yaradıb hər endpoint üçün çarpaz giriş cəhdi (403/404 gözlənilir) — CI-da məcburi.

---

## 5. Database modeli

> **MongoDB qeydləri:** (1) Prisma boş buraxılan optional sahəni sənədə yazmır və `{ sahə: null }` filtri yazılmamış sahəni tapmır — `@axis/db/null-fill` middleware-i hər create-də boş sahələri açıq `null` yazır (API və seed eyni kodu istifadə edir). (2) Null ola bilən unikal sahələr (`inviteToken`, `directKey`, `Message.externalId`…) partial unique index-dir. (3) "NULLS LAST" yoxdur — lazım olan siyahılar yaddaşda sıralanır. (4) **Prisma-nın MongoDB müqayisələrində `null` hər tarixdən kiçikdir:** nullable tarixdə `lt`/`lte` filtri `null`-ları da tutur — həmişə `not: null` ilə birlikdə yazılmalıdır (məs. gecikmiş tapşırıqlar). `gt`/`gte` təhlükəsizdir. (5) **Yazılar `w=majority&journal=true` ilə** (bağlantı ünvanında): əks halda tranzaksiyalar "çoxluq snapshot"-ından oxuduğu üçün yenicə təsdiqlənmiş yazını (məs. qeydiyyatdan sonrakı ilk sorğuda sessiyanı) görməyə bilər. (6) Sətir kilidi yoxdur — eyni anda icrası təhlükəli əməliyyatlar (sahibin endirilməsi) tenant sənədinə yazaraq seriallaşdırılır; MongoDB toqquşan tranzaksiyalardan birini dayandırır, `scoped()` onu təkrarlayır.

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
signup ─▶ TRIALING (14 gün, BUSINESS — bütün funksiyalar; sahib hər şeyi sınayıb sonra seçsin)
TRIALING ── ödəniş ─▶ ACTIVE
TRIALING ── trial bitdi, ödəniş yox ─▶ SUSPENDED (yalnız oxumaq + billing səhifəsi)
ACTIVE ── ödəniş uğursuz ─▶ PAST_DUE (7 gün grace, 1/3/5-ci gün təkrar cəhd + email)
PAST_DUE ── ödəniş ─▶ ACTIVE
PAST_DUE ── grace bitdi ─▶ SUSPENDED
SUSPENDED ── 90 gün ─▶ CANCELED (data export imkanı, sonra silinmə) — ⏳ hələ avtomatik deyil
ACTIVE ── "dövrün sonunda ləğv et" ─▶ dövr bitəndə CANCELED (yalnız oxumaq)
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
| **1. Core backend** | NestJS API, auth, tenant konteksti + izolyasiya, members/rollar/dəvət, Docker Compose, seed, CI | Real login, real tenant |
| **2. CRM + Satışlar** | Kontaktlar, kart, zaman xətti, deal Kanban (drag&drop), lost reason, forecast; Dashboard real API-yə keçir | |
| **3. Tapşırıqlar + Komanda** | Tasks/projects, şərh, fayl (S3), bildirişlər, gecikmə job-u; işçi profili və performans | |
| **4. Inbox** | Sayt çatı widget, WebSocket, WhatsApp/IG/Messenger adapterləri + demo simulyator, şablonlar, SLA metrikləri | |
| **5. Komanda çatı** | Otaqlar, real-time, axtarış, tapşırıq linki | |
| **6. Billing** | Plan/entitlement servisi, trial/grace job-ları, ödəniş adapteri, faktura | Satışa hazır |
| **7. Super Admin** | `/admin` (apps/web daxilində, ayrıca sessiya), tenant idarəsi, plan redaktoru, gəlir/xərc/mənfəət, tiketlər, sistem sağlamlığı | |
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
| Paket feature-larına görə bloklama (məs. şöbələr yalnız BUSINESS) | ✅ | Mərhələ 6-da |
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

### Mərhələ 5 — Komanda çatı ✅
| Hissə | Vəziyyət | Harada |
|---|---|---|
| Şəxsi çat (cütlük üçün tək otaq), şöbə qrupu (avtomatik, üzvlər şöbə ilə sinxron — şöbədən çıxan tarixçəyə girişi itirir), adlı qruplar (üzv əlavə et, çıx) | ✅ | `apps/api/src/chat`, `/chat` |
| Mesajlar: mətn, fayl (tapşırıq faylları ilə eyni kvota və saxlama), tapşırığa bağlantı (yalnız tapşırığı görə bilənlərə göstərilir), öz mesajını redaktə/silmək, mesajı tapşırığa çevirmək, əvvəlki mesajları yükləmək | ✅ | |
| Real vaxt: SSE hadisələri **yalnız otağın üzvlərinə** çatır; oxunmamış sayğaclar (otaq və sidebar) | ✅ | tək instans; çoxlu instansda Redis pub/sub |
| Axtarış yalnız üzv olduğunuz otaqlarda | ✅ | |
| Müştəri yazışmalarından ayrı: ayrı cədvəllər, ayrı ekran, fərqli rəng | ✅ | |
| Sesli/görüntülü zəng, mesaja reaksiya, "yazır…" göstəricisi | ⏳ | sonra |

**Bu mərhələdə tapılıb düzəldilənlər:**
- **Rate limit bütün ofisi bir yerdə sayırdı:** daxil olmuş istifadəçilərin sorğuları IP başına məhdudlaşdırılırdı — bir ofis IP-si arxasındakı 20 işçi limiti tez doldurub səhifələri çökdürərdi (UI testləri ardıcıl icrada bunu üzə çıxardı). İndi daxil olmuş trafik istifadəçi başına (imzası yoxlanmış token ilə), anonim trafik IP başına sayılır.
- API xətası səhifəni "Application error" ilə çökdürürdü → tətbiq üzrə xəta ekranı və "Yenidən cəhd et".
- Modul dövri asılılığı (notifications → chat → files → tasks → notifications) Nest DI-ni pozurdu → asılılıqsız köməkçi fayla çıxarıldı.

**Testlər:** 83 API e2e (o cümlədən 9 çat: cütlük otağı, şöbə sinxronu, qruplar, çarpaz şirkət, redaktə/silmə hüququ, tapşırıq görünməsi, fayl girişi, axtarış, SSE yalnız üzvlərə) + 8 web unit + 12 Playwright UI (5 ardıcıl icrada stabil).

### PostgreSQL → MongoDB köçürməsi ✅ (2026-10-23, sahibin qərarı)
| Hissə | Vəziyyət | Qeyd |
|---|---|---|
| Sxem MongoDB konnektoruna, ID-lər `_id`, öz-özünə istinad edən əlaqələr `NoAction` (alt tapşırıq/şöbə uşaqları servis tərəfindən təmizlənir) | ✅ | `packages/db/prisma/schema.prisma` |
| RLS → tenant qoruyucusu (oxuma daraldılır, yazı yoxlanılır, kontekstsiz heç nə; `system()` açıq keçid) | ✅ | **Qoruma bazada deyil, koddadır** — §4 |
| Lokal baza: `mongodb-memory-server` replica set (`.data/mongo`), testlərdə müvəqqəti replica set; Docker: `mongo:7.0 --replSet` | ✅ | |
| SQL-ə bağlı yerlər əvəz edildi: `FOR UPDATE` → tenant sənədi ilə seriallaşdırma + təkrar; SECURITY DEFINER funksiyaları → `system()` ilə yalnız-id sorğular; `NULLS LAST` → yaddaşda sıralama; `skipDuplicates` → əvvəlcədən filtr | ✅ | |
| Null semantikası (`@axis/db/null-fill`), partial unique index-lər | ✅ | |
| Köhnə PostgreSQL məlumatı | ⚠️ köçürülməyib | yalnız lokal dev/test məlumatı idi; demo seed yenidən yaradıldı |

**Köçürmə zamanı tapılan və düzəldilən problemlər:** (1) Prisma optional sahələri yazmadığı üçün `null` filtrləri səssizcə heç nə tapmırdı (müştəri və tapşırıq siyahıları boş olardı) → null-fill. (2) Prisma sorğuları "lazy" olduğu üçün tenant konteksti `await`-dən əvvəl itirdi → qoruyucu kontekst blokunun içində gözlənilir. (3) `.env` faylını əvəzləmə zamanı özüm korlamışdım → git-dən bərpa edildi. (4) `dueAt < indi` son tarixi olmayan tapşırıqları da "gecikmiş" sayırdı (Dashboard çökürdü, fon prosesi bütün tarixsiz tapşırıqlar üçün bildiriş göndərərdi) → `not: null`, reqressiya testi. (5) Ara-sıra qeydiyyatdan sonrakı ilk sorğu 401 alırdı → əvvəlcə `w=majority&journal=true` ilə düzəldiyi düşünüldü, amma əsl səbəb Mərhələ 6-da tapıldı (aşağıda, test mühiti problemi idi, məhsul xətası deyildi). (6) Real vaxt yenilənməsi HTTP cavabından tez gələndə mesaj sahəsi istifadəçinin yeni yazdığı mətni silirdi (inbox, çat, şərh, qeyd) → yalnız göndərilmiş mətn təmizlənir.

### Mərhələ 6 — Abunəlik və ödəniş ✅ (DEMO provayder)
| Hissə | Vəziyyət | Harada |
|---|---|---|
| Paketlər, aylıq/illik (illik = 10 ay), əlavə işçi yeri və yaddaş | ✅ | `apps/api/src/billing`, `/settings/billing` |
| Checkout: yeni dövr; eyni intervalda yüksəltmə — qalan günlər üçün proporsional; interval dəyişəndə — istifadə olunmamış hissə kredit kimi çıxılır; 0 məbləğ avtomatik ödənir; köhnə açıq fakturalar ləğv olunur | ✅ | |
| Ucuz pakete keçid dövrün sonunda (işçi sayı yeni limitdən çoxdursa rədd edilir), keçidi geri almaq | ✅ | |
| Fon prosesi: trial xəbərdarlığı və bitməsi, yenilənmə, uğursuz ödəniş → PAST_DUE + 7 gün güzəşt, 1/3/5-ci gün təkrar cəhd, sonra SUSPENDED, dövrün sonunda ləğv | ✅ | `billing.job.ts`, 10 dəqiqədən bir |
| SUSPENDED/CANCELED: yalnız oxumaq (GET), abunəlik və bildirişlər açıq qalır; ödənişdən sonra dərhal aktiv | ✅ | `AuthGuard` |
| Feature gating: API (402 `FEATURE_NOT_IN_PLAN`) + UI (sidebar-da kilid, "Paketi yüksəlt" ekranı, Meta kanalları və şöbə yaratma bağlı) | ✅ | `@RequireFeature`, `UpgradeGate` |
| Faktura nömrələri ardıcıl (`AX-2026-000001`), çap üçün faktura səhifəsi, bildirişlər (ödəniş alındı / alınmadı / trial bitir / dayandırıldı), hər səhifədə xəbərdarlıq zolağı | ✅ | |
| **DEMO ödəniş provayderi** — ödəniş səhifəsi aydın "DEMO" işarəlidir, real kart yoxdur; "Uğurlu ödəniş" / "Kart rədd edilsin"; demo alətləri: növbəti avtomatik ödəniş uğursuz olsun, növbəti tarixi indi işlət | ✅ | `DemoPaymentProvider`, `BILLING_PROVIDER=demo` |
| Real provayder (Payriff / Epoint) | ⏳ | `PaymentProvider` interfeysi hazırdır: `checkoutUrl` + `chargeSaved` + webhook; müqavilə və açarlar lazımdır |
| Ödəniş qəbzinin email-lə göndərilməsi, ƏDV, SUSPENDED → 90 gündən sonra CANCELED, Super Admin-də paket redaktəsi | ⏳ | sonra |

**Bu mərhələdə tapılıb düzəldilənlər:**
- **Testlərdəki "təsadüfi 401/404"-ün əsl səbəbi:** supertest hər sorğuda serveri bütün interfeyslərdə (IPv6 `::`) təsadüfi portda açır, amma `127.0.0.1`-ə qoşulurdu. Həmin portu kompüterdəki başqa proqram IPv4-də tutanda sorğu bizim API-yə yox, o proqrama gedirdi (cavab gövdəsi bizim formatda deyildi). Diaqnostika ilə sübut olundu; test tətbiqi indi bir dəfə `127.0.0.1`-də dinləyir. Bu, məhsul xətası deyil, test mühiti xətası idi.
- Demo ödəniş səhifəsində kart rədd ediləndən sonra təkrar cəhd işləmirdi (faktura FAILED olurdu) → cəhd qeyd olunur, faktura açıq qalır, eyni səhifədə yenidən ödəmək olur.
- Paketsiz "Satışlar" funksiyası müştəri kartını 402 ilə çökdürərdi → kart pipeline-ı yalnız funksiya olanda yükləyir.

**Testlər:** 97 API e2e (o cümlədən 12 billing) + 8 web unit + 13 Playwright UI (yeni: trial → demo checkout → rədd/uğur → uğursuz yenilənmə və güzəşt → ödəniş → downgrade → PRO modullarının bağlanması).

### Mərhələ 7 — Super Admin ✅
| Hissə | Vəziyyət | Harada |
|---|---|---|
| Platforma girişi: yalnız `platformRole` olan istifadəçilər; ayrıca issuer, cookie və `AdminSession`; çıxış və rolun götürülməsi dərhal təsir edir; rollar SUPER_ADMIN (hər şey) və SUPPORT (baxış + müraciətlər) | ✅ | `apps/api/src/admin`, `/admin/login` |
| Ümumi baxış: MRR/ARR (illik = 1/12), statuslar üzrə şirkətlər, 30 günlük qeydiyyat/ləğv, gəlir/xərc/mənfəət, son 6 ayın qrafiki + cədvəl, uğursuz ödənişlər, açıq müraciətlər | ✅ | `/admin` |
| Şirkətlər: axtarış, status filtri, səhifələmə; detal (abunə, istifadə, işçilər, fakturalar, audit); sınağı uzatmaq, dayandırmaq (səbəblə), ödənilmiş dövr ərzində bərpa | ✅ | `/admin/tenants` |
| Paket redaktoru: qiymət, limit, əlavələrin qiyməti, funksiyalar; yeni qiymət növbəti fakturadan | ✅ | `/admin/plans` |
| Ödənişlər (bütün şirkətlər, status filtri, cəmlər), xərclər (əlavə et / sil) | ✅ | `/admin/billing`, `/admin/expenses` |
| Dəstək müraciətləri: şirkət yazır (`/support`), platforma cavab verir; müəllifə bildiriş; şirkət cavabı «Axis dəstək» adı ilə görür; bağlı müraciətə yazanda yenidən açılır; dayandırılmış şirkət də yaza bilir | ✅ | `apps/api/src/support`, `/support`, `/admin/tickets` |
| Sistem: baza (gecikmə), iş müddəti, yaddaş, fon proseslərinin son icrası və xətası, webhook və kanal xətaları, ödəniş provayderi | ✅ | `/admin/system` |
| Platforma əməliyyatları şirkətin öz audit jurnalında da görünür (`platform.*`) | ✅ | |
| Platforma hesabları üçün 2FA | ✅ | Mərhələ 8-in 2-ci hissəsində |
| Impersonate (şirkətə onun adından baxmaq), `admin.axis.az` host yönləndirməsi, email bildirişləri | ⏳ | |

**İlk Super Admin:** `.env`-də `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`, sonra `npm run db:seed` (şifrə yalnız hesab yaradılarkən yazılır). Demo: `platform@demo.axis`, `support@demo.axis` (şifrə `demo12345`).

**Bu mərhələdə tapılıb düzəldilənlər:**
- Demo seed platforma rolunu demo şirkətin işçisi `admin@demo.axis`-ə verirdi (şirkət hesabı ilə platforma hesabı qarışırdı) → ayrıca `platform@demo.axis`.
- **Mobil görünüş:** bir neçə səhifə telefonda yana sürüşürdü. Səbəb: (1) grid sütunu cədvəlin eninə qədər böyüyürdü (çat, inbox, admin), (2) cədvəl başlığındakı ekran oxuyucu mətni (`sr-only`, absolute) sürüşən konteynerdən çıxırdı (abunəlik, müştərilər, işçilər). İndi bütün səhifələr 390px-ə sığır; bunu yoxlayan UI testi əlavə olundu.
- Qeydiyyat səhifəsi hələ də "PRO sınaq" yazırdı, halbuki sınaq bütün funksiyalarla işləyir → mətn düzəldildi (az/en/ru).
- Müvəqqəti diaqnostika ilə təsdiqləndi: testlərdəki təsadüfi 401 xətası ardıcıl 10 icrada bir dəfə də təkrarlanmadı.

**Testlər:** 107 API e2e (yeni 10 admin testi: sessiyaların ayrılığı, rol götürülməsi, rəqəmlərin real ödənişlə dəyişməsi, şirkət əməliyyatları, SUPPORT məhdudiyyətləri, paket qiyməti, müraciət axını və izolyasiya, sistem) + 8 web unit + 16 Playwright UI (yeni: admin axını, 2 mobil en testi).

### Mərhələ 8 (1-ci hissə) — Analitika, avtomatlaşdırma, prioritet dəstək ✅
Səbəb: bu funksiyalar paketlərdə satılırdı (PRO: əsas analitika; BUSINESS: geniş analitika, avtomatlaşdırma, prioritet dəstək), amma hələ mövcud deyildi.

| Hissə | Vəziyyət | Harada |
|---|---|---|
| **Əsas analitika (PRO):** sövdələşmələrin nəticəsi, qazanma faizi, orta sövdələşmə və satış müddəti, satış hunisi, itirmə səbəbləri, müştəri mənbələri (alıcıya çevrilmə, gətirdiyi gəlir), kanallar üzrə ilk cavab, tapşırıqların vaxtında icrası; 30 gün / 90 gün / 1 il | ✅ | `apps/api/src/analytics`, `/analytics` |
| **Geniş analitika (BUSINESS):** işçilər üzrə nəticələr (qazanma faizi, gəlir, müddət, tapşırıqlar, cavab müddəti), 12 aylıq dinamika, sövdələşmələrin CSV ixracı (`deals.export` icazəsi, Excel üçün BOM, formula hücumuna qarşı qorunma) | ✅ | |
| Görünürlük CRM ilə eynidir: sahib/admin — bütün şirkət, rəhbər — şöbə, işçi — giriş yoxdur (`analytics.view`) | ✅ | |
| **Avtomatlaşdırma (BUSINESS):** «belə olanda — bunu et» qaydaları. Hadisələr: yeni sövdələşmə, mərhələ dəyişməsi, yeni müştəri, yeni yazışma, gecikən tapşırıq. Şərtlər: mərhələ, minimum məbləğ, mənbə, kanal. Əməliyyatlar: tapşırıq yarat, bildiriş göndər, məsul təyin et (bir nəfərə və ya növbə ilə). 4 hazır nümunə, icra tarixçəsi, son xəta | ✅ | `apps/api/src/automations`, `/automations` |
| Etibarlılıq: hadisə dəyişikliklə eyni tranzaksiyada yazılır (outbox), commit-dən dərhal sonra və 30 saniyədən bir işlənir; bir neçə instansda təkrar icra olunmur; xətalı qayda digərlərini dayandırmır; avtomatlaşdırmanın etdiyi dəyişiklik yeni hadisə yaratmır (sonsuz dövr yoxdur); paket endiriləndə qaydalar qalır, amma işləmir | ✅ | `automation.runner.ts` |
| **Prioritet dəstək (BUSINESS):** belə şirkətlərin müraciətləri platforma növbəsində birinci gəlir, «Prioritet» nişanı ilə | ✅ | `/admin/tickets` |
| Yeni icazə `automations.manage` (sahib və admin); icazə matrisi testi yeniləndi | ✅ | |
| AI, email kanalı, ümumi Fayllar bölməsi | ⏳ | Mərhələ 8 (2-ci hissə) / 9 |

**Bu mərhələdə tapılıb düzəldilənlər:**
- Demo seed-də bağlanmış sövdələşmələrin yaradılma tarixi bağlanma tarixindən sonra idi; analitika mənfi satış müddəti göstərirdi. Seed düzəldildi, analitikaya da müdafiə əlavə olundu.
- Bakı vaxtı ilə ayın başlanğıcı UTC-də əvvəlki günün 20:00-ı olduğu üçün aylıq dinamika ayları bir ay geri göstərərdi → saat qurşağını nəzərə alan format funksiyası və unit test.
- Avtomatlaşdırma şərtindəki «mənbə» sərbəst mətn idi, amma müştəri mənbələri sabit siyahıdır → seçim siyahısı.

**Testlər:** 117 API e2e (yeni: 4 analitika, 5 avtomatlaşdırma, 1 prioritet dəstək) + 9 web unit + 18 Playwright UI (yeni: analitika + CSV yükləmə; avtomatlaşdırma nümunədən real vaxtda işləməyə qədər; mobil en testinə yeni səhifələr).

### Mərhələ 8 (2-ci hissə) — 2FA, email, Fayllar, AI, email kanalı ✅
| Hissə | Vəziyyət | Harada |
|---|---|---|
| **Platforma işçiləri üçün 2FA** (TOTP, RFC 6238 — Google/Microsoft Authenticator, 1Password): QR ilə qurulma, 10 birdəfəlik ehtiyat kod, hər kod yalnız bir dəfə işləyir (təkrar istifadəyə qarşı qorunma), iki addımlı giriş (parol → 5 dəqiqəlik challenge → kod). `PLATFORM_REQUIRE_MFA` (production-da default açıq): 2FA aktiv edilməyincə konsolun yalnız təhlükəsizlik səhifəsi açılır, API də bunu tələb edir | ✅ | `common/totp.ts`, `/admin/security` |
| **Email servisi** (outbox, növbə, 5 təkrar cəhd): dəvət, şifrə bərpası, ödəniş qəbzi, dəstək cavabı — 3 dildə. **SMTP qoşulmayıbsa heç nə "göndərildi" kimi göstərilmir**: status "göndərilməyib", dəvət linki UI-də qalır; Super Admin → Sistem-də emaillərin statusu (mətn göstərilmir — bərpa linkləri gizli qalır) | ✅ | `apps/api/src/mail` |
| **Şifrə bərpası**: birdəfəlik link (60 dəq), yalnız ən yeni link işləyir, naməlum email üçün eyni cavab, bərpadan sonra bütün cihazlarda çıxış | ✅ | `/forgot-password`, `/reset-password/[token]` |
| **Fayllar bölməsi**: şirkətin ümumi sənədləri + tapşırıq və çat faylları — hər istifadəçi yalnız aça bildiyi faylları görür (çatlar sahib üçün də gizlidir); axtarış, mənbə filtri, yaddaş istifadəsi; ümumi sənədi yükləyən, sahib və admin silə bilər | ✅ | `/files` |
| **AI köməkçisi (Claude, `claude-opus-5-5`)**: yazışmada cavab qaralaması (müştərinin dilində, heç vaxt avtomatik göndərilmir, daxili qeydlər qaralamaya düşmür) və xülasə. Paket limiti (`Plan.aiCredits`: PRO 100, BUSINESS 500 sorğu/ay), uğursuz sorğu limiti geri qaytarır; müştəri mətni prompt-injection-a qarşı ayrıca etiketlərdədir; server tərəfi fallback (`fallbacks: "default"`) aktivdir. Açar yoxdursa düymələr səbəbi göstərir | ✅ | `apps/api/src/ai` |
| **Email kanalı**: gələn məktublar provayderin inbound webhook-u ilə (Postmark formatı, hər kanalın gizli tokeni, yalnız yaradılanda bir dəfə göstərilir), cavablar kanal ünvanından `In-Reply-To`/`References` ilə; çatdırılma statusu real göndərişə görə yenilənir. SMTP olmadan real email kanalı yaradılmır (demo mümkündür) | ✅ | `/v1/webhooks/email/:id` |
| Tamamlanmamış modul ekranı (`[module]`, «Mərhələ N») silindi — bütün modullar artıq işləyir | ✅ | |
| Şirkət işçiləri üçün 2FA, IMAP ilə email qəbulu, AI ilə CRM xülasələri | ⏳ | sonra |

**Bu mərhələdə tapılıb düzəldilənlər:**
- Brauzer klienti istənilən 401 cavabında istifadəçini sessiyadan çıxarırdı — yanlış 2FA kodu da girişə atırdı. İndi yalnız `UNAUTHENTICATED` sessiyanı bitirir.
- Admin proxy bütün `auth/*` sorğularını bağlayırdı (tokenlər brauzerə çıxmasın deyə) və 2FA qurulması işləmirdi → yalnız 2FA idarəetmə sorğuları açıldı; giriş və kod yoxlaması yenə yalnız server formalarından keçir.
- Demo email kanalının ünvanı unikal açar idi — iki şirkət eyni demo ünvanı yarada bilmirdi → demo kanallar təsadüfi açar alır.
- Uğursuz email göndərişi eyni keçiddə dərhal təkrarlanırdı → növbəti keçidə (30 san) saxlanılır.

**Testlər:** 131 API e2e (yeni: 2FA, email/şifrə bərpası, Fayllar, AI — saxta model klienti ilə, real API çağırılmır, email kanalı) + 9 web unit + 22 Playwright UI (yeni: 2FA qurulması və girişi, şifrə bərpası, Fayllar, demo email kanalı və AI düymələrinin vəziyyəti).

### UI/UX auditi (2026-10-25, `ui-ux-pro-max` skill-i + axe-core) ✅
Ölçü: axe-core (WCAG 2.0/2.1/2.2 A+AA), 28 səhifə × açıq/qaranlıq tema + mobil = 56 skan; hədəf ölçüsü, başlıq ardıcıllığı, skip link, kiçik mətn.

| Tapıntı | Əvvəl | Düzəliş |
|---|---|---|
| Rəng kontrastı (`fg-subtle`, `success`, `warning`, `danger`, `accent-soft`) | 1020 element, 56 skan | Tokenlər səviyyəsində: hər birinin ≥4.5:1 olduğu hesablandı (öz 10% fonu daxil); brend mavisi dəyişmədi |
| Dashboard qrafiki: 6–19px enində 30 düymə, yanlış ARIA rolu | 90 + hədəf ölçüsü | Bir fokuslanan qrafik: ← → / Home / End, siçan və toxunma ilə seçim, dəyər canlı oxunur |
| Skip link yox idi | bütün səhifələr | «Əsas məzmuna keç» (şirkət və platforma konsolu) |
| Eyni adlı landmark-lar, ARIA xətaları (tasks `aria-pressed` linkdə, rolsuz `aria-label`, zəngin adı) | 46 | Düzəldildi |
| Boş Kanban lövhəsi klaviatura ilə sürüşdürülə bilmirdi | — | Lövhə fokuslanan region oldu (satışlar, tapşırıqlar) |
| Kiçik hədəflər (20–21px), 10px mətn | — | 24px+, 10px → 11px |
| `prefers-reduced-motion` yox idi; sticky başlıq fokusu gizlədə bilərdi | — | Animasiyalar azaldılır; `scroll-padding-top` |
| Toxunma ekranında 44px | — | `pointer: coarse`-da düymə və sahələr ≥44px |

**Nəticə:** 1156 → **0** avtomatik pozuntu. Davamlılıq üçün `e2e/a11y.spec.ts` (açıq/qaranlıq tema, boş şirkət) UI testlərinə əlavə edildi.
**Qalan (avtomatik yoxlanmayan):** ekran oxuyucu ilə əl ilə sınaq, 11px meta mətnlərin (WCAG minimum tələb qoymur) gələcəkdə 12px-ə qaldırılması, mobil ikon düymələrinin (32px) 44px-ə çatdırılması.

### AI provayderləri: OpenRouter və pulsuz modellər üzrə avtomatik keçid ✅ (2026-10-25)
| Hissə | Vəziyyət |
|---|---|
| `AI_PROVIDER=anthropic` (birbaşa) və ya `openrouter` — hər ikisi rəsmi Anthropic SDK ilə (OpenRouter-in Anthropic-uyğun Messages API-si) | ✅ |
| Model zənciri (`AI_MODELS`, vergüllə): biri limitə dirənsə (429 → `retry-after` qədər), krediti bitsə (402 → 10 dəq), əlçatmaz olsa (403/404 → 1 saat), xəta versə (5xx/timeout → 30 san) — növbəti model cavab verir; açar yanlışdırsa (401) dərhal dayanır | ✅ |
| OpenRouter default zənciri yalnız **pulsuz** modellərdir (gözlənilməz xərc yoxdur): Nemotron 3 Ultra, Gemma 4 31B, Gemma 4 26B, Nemotron 3.5 Lightning. Pullu Claude istənərsə `AI_MODELS`-ə əlavə olunur | ✅ |
| Cavabda hansı modelin yazdığı göstərilir; Super Admin → Sistem-də hər modelin vəziyyəti (hazır / gözləmədə, son xəta, son uğur) | ✅ |
| Testlər: saxta OpenRouter serveri ilə zəncir (429/404/500/402/401) + real yoxlama (pulsuz Nemotron Ultra Azərbaycan dilində qaralama və xülasə yazdı) | ✅ |

Qeyd: pulsuz modellər OpenRouter-də gün/dəqiqə limitlidir və keyfiyyət Claude-dan aşağıdır (arabir rus sözü qarışa bilər); qaralamalar onsuz da göndərilməzdən əvvəl işçi tərəfindən yoxlanır.

### Növbəti
Production-a çıxış: real ödəniş provayderi (Payriff / Epoint — seçim və müqavilə), SMTP provayderi, `ANTHROPIC_API_KEY`, domen (`axis.az`, `admin.axis.az`), monitorinq. Sonra: şirkət işçiləri üçün 2FA, mobil tətbiq.
