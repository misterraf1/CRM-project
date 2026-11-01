# Axis — Hər biznesə uyğun, sadə və inteqrasiyalı CRM planı (2026-11-01)

Məqsəd: hər biznes sistemi öz işinə uyğunlaşdırsın, hər şey ilk baxışdan aydın olsun, mövcud bütün məlumatlarını (nömrələr, müştərilər, satışlar və s.) bir dəfəyə köçürə bilsin və ən çox istifadə olunan sistemlərlə inteqrasiya olsun.

Qaydalar: mövcud məlumat silinmir və sıfırlanmır, ödəniş inteqrasiyası hələlik edilmir, AZ/EN/RU saxlanılır. Real işləməyən inteqrasiya "Tezliklə" kimi göstərilir, hazır kimi yox.

## Hazırkı vəziyyət (kodda yoxlanılıb)
- **Var:** fərdi sahələr, bir neçə satış prosesi və fərdi mərhələlər, rollar və icazələr, onboarding checklist, 4 biznes şablonu (istehsal, agentlik, hosting, xidmət), sayt formu, Cmd+K axtarışı.
- **İdxal:** yalnız şəxs, şirkət və satış üçün.
- **Yoxdur:**
  - bölmələri açıb-bağlamaq;
  - terminləri dəyişmək ("Müştəri" → "Pasiyent");
  - məhsul, sifariş, tapşırıq və ödəniş idxalı;
  - başqa CRM-dən köçürmə;
  - idxalı geri qaytarmaq;
  - Public API və webhook-lar;
  - təqvim və poçt sinxronizasiyası;
  - telefoniya və SMS.

## U1 — Biznes növünə görə hazır qurulum (sadəlik üçün ən vacib)
1. **Qeydiyyatdan sonra "Biznesiniz nədir?" sihirbazı.** Sahə seçilir, nəticə önizlənir və bir kliklə tətbiq olunur. Sonradan dəyişmək mümkündür, mövcud məlumat silinmir.
2. **Şablonların sayı 4-dən ~15-ə çatdırılır:**
   - pərakəndə / onlayn mağaza;
   - klinika / stomatologiya;
   - gözəllik salonu;
   - daşınmaz əmlak;
   - təhsil / kurslar;
   - turizm;
   - avtoservis;
   - tikinti / təmir;
   - logistika;
   - restoran / catering;
   - hüquq / mühasibat xidməti;
   - agentlik;
   - istehsal / topdan satış;
   - IT / hosting;
   - ümumi xidmət.

   Hər şablon bunları gətirir:
   - satış prosesi və mərhələlər;
   - fərdi sahələr (məsələn, klinika üçün "Həkim", "Növbəti qəbul");
   - məhsul və xidmət nümunələri;
   - avtomatlaşdırmalar;
   - hansı bölmələrin görünəcəyi;
   - **terminologiya**.
3. **Bölmələri açıb-bağlamaq** (Ayarlar → Bölmələr). Sidebar yalnız istifadə olunanları göstərir: kiçik mağazaya Dəstək və Kampaniyalar lazım deyilsə, gizlənir. Məlumat silinmir, sadəcə gizlənir.
4. **Terminologiya.** "Müştəri", "Satış", "Sifariş" və mərhələ adlarını şirkət öz dilinə uyğun dəyişir: Pasiyent, Tələbə, Obyekt, Müraciət. Bütün menyu, başlıq və bildirişlərdə tətbiq olunur, AZ/EN/RU-nun hər biri ayrıca.

## U2 — Hər kəs öz işinə uyğunlaşdırsın
1. **Kart quruluşu.** Müştəri, satış və məhsul kartında sahələr sürüşdürülərək bölmələrə yığılır, sırası dəyişir, lazımsız standart sahə gizlənir.
2. **Mərhələ üzrə məcburi sahələr.** Məsələn, "Müqavilə" mərhələsinə keçmək üçün "Müqavilə nömrəsi" doldurulmalıdır.
3. **Siyahı sütunları.** Göstərilən sütunları, o cümlədən fərdi sahələri, istifadəçi özü seçir. Seçim yadda qalır.
4. **Saxlanmış filtrlər.** Şəxsi və ya komanda üçün saxlanır, tab kimi görünür.
5. **Dashboard vidjetləri.** Kartları əlavə etmək, silmək və yerini dəyişmək olur. Rol üzrə standart dashboard da qurulur.
6. **Sənəd şablonları.** Təklif, faktura və müqavilə üçün loqo, rekvizitlər, mətn blokları və dəyişənlər (`{müştəri.ad}`).
7. **Fərdi bölmələr (custom obyektlər).** Böyük arxitektura dəyişikliyidir. Məsələn, "Avtomobillər", "Obyektlər", "Kurslar": öz sahələri, siyahısı, kartı, müştəriyə bağlantısı və idxalı ilə. Başlamazdan əvvəl ayrıca dizayn sənədi yazılır və təsdiqə təqdim olunur.

## U3 — Hər şeyi bir dəfəyə köçürmək (İdxal mərkəzi)
1. **İdxal ediləcək bütün obyektlər:**
   - şəxslər;
   - şirkətlər;
   - satışlar;
   - məhsullar və qiymətlər;
   - sifarişlər;
   - fakturalar və ödəniş qeydləri;
   - tapşırıqlar;
   - qeydlər və zəng tarixçəsi;
   - əlavə telefon nömrələri;
   - fərdi bölmələr (U2.7-dən sonra).
2. **Bir Excel faylı, çox vərəq.** Hər vərəq bir obyektdir. Sistem vərəqləri və sütunları özü tanıyır: "Tel", "Mobil", "Телефон" telefon sahəsinə düşür. Tanınmayan sütun üçün bir kliklə yeni fərdi sahə yaradılır.
3. **Əlaqələrin avtomatik bağlanması.** Satış müştəriyə telefon, e-poçt və ya adla bağlanır, sifariş məhsula SKU və ya adla. Tapılmayanlar üçün ayrıca hesabat verilir.
4. **Nömrələrin təmizlənməsi:**
   - Azərbaycan formatına salınır: `050 123 45 67` → `+994501234567`;
   - bir xanada bir neçə nömrə ayrılır;
   - yanlış nömrə xəta faylına düşür.
5. **Yoxlama, tətbiq və geri qaytarma:**
   - əvvəl yoxlama: neçə yeni, neçə yenilənən, neçə dublikat, neçə xəta;
   - sonra tətbiq;
   - **idxalı geri qaytarmaq:** həmin idxalda yaradılan qeydlər arxivə gedir, yenilənən qeydlər əvvəlki vəziyyətinə qayıdır.
6. **Hazır nümunə faylı.** Seçilmiş biznes şablonuna uyğun Excel faylı yüklənir.
7. **Başqa CRM-dən köçürmə.** Bitrix24, amoCRM, HubSpot, Pipedrive, Zoho və Google Sheets export faylları üçün hazır sütun xəritəsi olur, Excel faylından da köçürmək mümkündür. Daha sonra API ilə birbaşa köçürmə də əlavə olunur (açarı müştəri verir).
8. **Böyük fayllar** (100 min sətrə qədər) fonda işlənir. İşlənmə prosesi göstərilir, bitəndə bildiriş gəlir.

## U4 — Sadəlik və başa düşülənlik
1. **İlk giriş:** 5 addımlıq checklist (şablon, işçi dəvəti, idxal, kanal qoşmaq, ilk satış) və isteğe bağlı nümunə məlumat. Nümunə məlumat bir kliklə silinir.
2. **Boş ekranlar** nə edəcəyini göstərir: "İlk müştərini əlavə et / Excel-dən köçür / Saytı qoş".
3. **"?" kömək paneli.** Hər səhifədə 3–4 cümləlik izah və qısa video linki, AZ/EN/RU.
4. **Sadə və Geniş rejim.** Sadə rejimdə nadir istifadə olunan sahələr və ayarlar gizlənir.
5. **Bələdçi tur.** Əsas səhifələrdə 4–5 addımlıq ipuçları göstərilir, bir dəfə görünür və yenidən açıla bilir.
6. **Mətn auditi.** Bütün düymə və mesajlar sadə dilə salınır, texniki söz qalmır.
7. **Yoxlama:** hər yeni ekran test istifadəçisi ilə "5 saniyə testi"ndən keçir. Playwright testləri sadə rejimi də əhatə edir.

## U5 — İnteqrasiyalar (ən çox istifadə olunanlar)
Hər inteqrasiya Ayarlar → İnteqrasiyalar səhifəsində kart kimi görünür və statusu göstərilir: Qoşulub / Qoşulmayıb / Tezliklə.

| Qrup | İnteqrasiya | Nə edir | Xaricdən lazım olan |
|---|---|---|---|
| **Əsas qapı** | **Public API + Webhook-lar** | Hər şeyi xarici sistemdən oxumaq və yazmaq, hadisə baş verəndə xəbər göndərmək | — (biz edirik) |
| | **Zapier, Make, n8n** | API vasitəsilə minlərlə servisə qoşulmaq | Tətbiqin onların kataloquna əlavəsi |
| Mesajlaşma | WhatsApp Business (Cloud API) | Söhbətlər, media, şablon mesajları | Meta verifikasiyası, token |
| | Telegram bot | Söhbətlər, media | @BotFather token |
| | Instagram Direct, Facebook Messenger | Söhbətlər | Meta App Review |
| Lead mənbələri | Facebook / Instagram Lead Ads | Reklam formu birbaşa lead olur | Meta icazəsi |
| | Google Ads lead formları | Webhook ilə lead | Google Ads hesabı |
| | Sayt formu, WordPress, Tilda | Forma → lead, UTM ilə | — (sayt formu hazırdır, plugin və snippet edilir) |
| E-poçt | Gmail, Outlook (Microsoft 365) | Gələn və gedən məktublar müştəri kartında, kartdan məktub göndərmək | Google və Microsoft OAuth |
| | SMTP (Resend, Postmark, SES) | Sistem məktubları, kampaniyalar | Provayder + domen DNS |
| Təqvim | Google Calendar, Outlook Calendar | İki tərəfli sinxronizasiya | OAuth |
| | Google Meet, Zoom | Görüşə link əlavə etmək | OAuth |
| Telefoniya | IP telefoniya (Zadarma, Twilio, Asterisk/FreePBX webhook) | Gələn zəngdə müştəri kartı açılır, zəng tarixçəsi, yazı, kartdan zəng | Provayder hesabı |
| SMS | Yerli SMS provayderi, Twilio | Xatırlatma və kampaniya SMS-i | Provayder hesabı |
| Fayllar | Google Drive, OneDrive | Faylı karta bağlamaq | OAuth |
| | Cloudflare R2 / S3 | Faylların saxlanması (kod hazırdır) | Bucket + açar |
| Mühasibat | 1C, Excel | Müştəri, məhsul və faktura mübadiləsi (fayl və API) | 1C tərəfində quraşdırma |
| E-ticarət | Shopify, WooCommerce | Sifarişlər və müştərilər avtomatik CRM-ə düşür | Mağaza API açarı |
| Analitika | Google Analytics, UTM | Lead-in hansı reklamdan gəldiyi | — |
| Marketinq | Mailchimp | Seqmentlərin sinxronizasiyası | API açarı |
| Ödəniş | Epoint, Payriff, Stripe | **Hələlik edilmir** (istəyinizə görə) | — |

İş qaydası:
- Ümumi inteqrasiya çərçivəsi qurulur: OAuth qoşulması, açarların şifrəli saxlanması, sinxronizasiya jurnalı, xəta və təkrar cəhd. Bütün inteqrasiyalar bunun üzərində olur.
- Xarici hesab tələb edən inteqrasiyalar kodda hazırlanır, test serverlə yoxlanılır və "hazır, açar gözləyir" kimi göstərilir. Canlı yoxlamanı açar verildikdən sonra edirik.

## Ardıcıllıq (asılılıqlara görə)

| # | Mərhələ | Nə üçün bu sırada |
|---|---|---|
| 1 | U1: sihirbaz, 15 şablon, bölmələr, terminologiya | İlk təəssürat və sadəlik; sonrakılar bunun üzərində qurulur |
| 2 | U3: İdxal mərkəzi | Müştərilərin keçidinə ən böyük maneə məlumatın köçürülməsidir |
| 3 | U4: onboarding, kömək, sadə rejim | U1 və U3 hazır olanda yeni istifadəçi axını tamamlanır |
| 4 | U5-a: Public API, webhook, inteqrasiya çərçivəsi, Zapier, Make, n8n | Bir işlə yüzlərlə sistemə qapı açılır |
| 5 | U2: kart quruluşu, sütunlar, saxlanmış filtrlər, vidjetlər, sənəd şablonları | Dərin fərdiləşdirmə |
| 6 | U5-b: Telegram, Lead Ads, Gmail/Outlook, Google Calendar, telefoniya, SMS, Shopify/WooCommerce, 1C | Hər biri ayrıca; açarlar gəldikcə canlı yoxlanılır |
| 7 | U2.7: Fərdi bölmələr | Ən böyük dəyişiklik; ayrıca təsdiqdən sonra |

Hər mərhələdən sonra hesabat verilir: nə edildi, nə qaldı, necə yoxlanıldı.

## Sizdən lazım olanlar
Bu hesablar inteqrasiyaların canlı işləməsi üçün lazımdır:
- Meta Business hesabı;
- Telegram bot tokeni;
- Google Cloud OAuth layihəsi;
- Microsoft 365 app qeydiyyatı;
- telefoniya və SMS provayderinin seçimi;
- SMTP və domen;
- R2 bucket.

Kod onlarsız da hazırlanır.

## Vəziyyət (2026-11-01)

| Mərhələ | Edildi | Qalan / qeyd |
|---|---|---|
| U1 | 15 biznes şablonu, «Biznesiniz nədir?» sihirbazı (önizləmə ilə), bölmələri gizlətmək, terminologiya (AZ/EN/RU ayrıca) — Ayarlar → Bölmələr | — |
| U3 | Məhsul və tapşırıq importu; bir Excel faylında çox vərəq (ad və ya sütunlara görə tanınır, vərəqlər arası bağlantı, tam yoxlama); +994 telefon formatı, bir xanada bir neçə nömrə (`extraPhones`); ad/soyad sütunları; Bitrix24/amoCRM/HubSpot/Pipedrive/Zoho başlıqları; bütün vərəqlərlə nümunə faylı; importu geri qaytarmaq | Sifariş, faktura, ödəniş, qeyd importu; 100 min sətir fonda (Vercel sorğu ölçüsü ~4.5 MB ilə məhduddur) |
| U4 | Hər səhifədə «?» kömək paneli, Sadə rejim, boş siyahıda «Excel-dən köçür» | Video dərslər, tam mətn auditi |
| U5-a | Public API açarları (scope-lar, OpenAPI `/api/v1/openapi.json`), imzalı webhook-lar (növbə, təkrar cəhd, jurnal, test), Zapier/Make/n8n bunların üzərindən | — |
| U2 | Siyahı sütunlarını seçmək (fərdi sahələr daxil), saxlanmış görünüşlər (şəxsi/komanda), mərhələ üzrə məcburi sahələr | Kartda sahələrin yerini sürüşdürmək |
| U5-b | Gələn ünvanlar: sayt formaları (Tilda, WordPress…), Google Ads lead formu, Shopify və WooCommerce sifarişləri (imza yoxlaması), IP telefoniya zəngləri (Zadarma və s.) | Facebook Lead Ads, Gmail/Outlook, Google Calendar/Drive, SMS — provayder hesabı/OAuth gözləyir; Mailchimp, ödəniş — sonra |
| U2.7 | Öz bölmələr: ad, ikon, sahələr; qeydlər müştəriyə bağlanır; menyuda görünür | Öz bölmələr üçün import və icazə ayarı |
