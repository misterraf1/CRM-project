# Axis — Production əməliyyatları (runbook)

Vercel (`fra1`) + MongoDB Atlas (Frankfurt) üçün.

## 1. Mühit dəyişənləri (Vercel → Settings → Environment Variables)

| Dəyişən | Production | Staging (Preview) | Qeyd |
|---|---|---|---|
| `DATABASE_URL` | Atlas prod cluster | **ayrıca** DB (`axis_staging`) | Staging heç vaxt prod DB-yə qoşulmur |
| `JWT_SECRET`, `CHANNEL_SECRET_KEY` | unikal | unikal | Mühitlər arasında paylaşılmır |
| `CRON_SECRET` | **məcburi** | məcburi | Olmasa `/api/cron` 401 qaytarır, fon prosesləri işləmir |
| `STORAGE_DRIVER=s3` + `S3_*` | prod bucket | ayrıca bucket | Vercel diski saxlanılmır |
| `SMTP_URL`, `MAIL_FROM` | provayder | test inbox (məs. Mailtrap) | |
| `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` | | | Paylaşılmış açar dərhal rotate edilməlidir |

## 1a. Hər deploy-dan əvvəl
`DATABASE_URL=<prod> npm run db:indexes` — indeksləri yaradır və yeni sahələri köhnə sənədlərə yazır (backfill). İdempotentdir. v2 B mərhələsindən sonra məcburidir: köhnə satışlarda `baseAmount` olmadan hesabatlar onları saymır.

## 2. Fayl saxlama (Cloudflare R2)
1. Cloudflare → R2 → bucket yaradın (`axis-files`), public access **bağlı** qalsın (fayllar API vasitəsilə, icazə yoxlaması ilə verilir).
2. R2 → Manage API tokens → "Object Read & Write", yalnız bu bucket.
3. Vercel-ə: `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
4. Köhnə lokal faylları köçürmək (lazım olsa): `npm run storage:migrate -- --dry-run`, sonra `npm run storage:migrate`. Açarlar eyni qalır, DB-yə toxunulmur, lokal fayllar silinmir.
5. Yoxlama: `/admin/system` → "Fayl saxlama: S3", qırmızı xəbərdarlıq olmamalıdır.

## 3. Fon prosesləri
- Avtomatlaşdırma və email cavab göndərildikdən dərhal sonra `after()` ilə icra olunur (serverless funksiyası iş bitənə qədər açıq qalır).
- Gecikmiş tapşırıq bildirişləri, billing, uğursuz email təkrarı və ilişib qalmış hadisələr `/api/cron` ilə işləyir.
  - Vercel Hobby: cron gündə 1 dəfə (`vercel.json`). Kifayət deyil.
  - Tövsiyə: Vercel Pro-da `vercel.json` cədvəlini `*/5 * * * *` etmək **və ya** xarici scheduler (cron-job.org, GitHub Actions) hər 5 dəqiqədən bir `GET https://<domen>/api/cron` çağırır, `Authorization: Bearer <CRON_SECRET>` başlığı ilə.
- Yoxlama: `/admin/system` → "Fon prosesləri" cədvəli; `CRON_SECRET` yoxdursa sarı xəbərdarlıq görünür.

## 4. Xəta monitorinqi
- Gözlənilməz API xətaları (500) və uğursuz fon prosesləri `ErrorEvent` kolleksiyasına qruplaşdırılmış şəkildə yazılır: `/admin/system` → "Server xətaları".
- Əlavə olaraq Vercel → Logs (runtime) istifadə olunur. Sentry sonradan qoşula bilər (DSN lazımdır).

## 5. Backup və bərpa testi
1. Atlas → Backup: Continuous Cloud Backup (M10+) və ya ən azı gündəlik snapshot, 7+ gün saxlama.
2. **Rübdə bir dəfə bərpa testi**: son snapshot-u yeni cluster-ə restore edin → `DATABASE_URL`-i staging-də ona yönəldin → giriş, kontakt siyahısı, fayl yükləmə yoxlanılır → nəticə (tarix, müddət, problem) bu sənədin sonuna yazılır.
3. R2 bucket üçün: object versioning və ya gündəlik `rclone sync` ikinci bucket-ə.

## 6. Açar rotasiyası
Paylaşılmış və ya sızmış açar: provayderdə yeni açar yaradın → Vercel env-i yeniləyin → redeploy → köhnə açarı silin. `CHANNEL_SECRET_KEY` dəyişdirilərsə qoşulmuş kanalların tokenləri yenidən daxil edilməlidir.

## 7. Domen və SMTP
- Domen Vercel-ə əlavə olunur, HTTPS avtomatikdir.
- Email domeni üçün SPF, DKIM, DMARC qeydləri provayderin göstərdiyi kimi əlavə olunur. `MAIL_FROM` həmin domendən olmalıdır.

## Bərpa testləri jurnalı
| Tarix | Snapshot | Müddət | Nəticə |
|---|---|---|---|
| — | — | — | hələ aparılmayıb |
