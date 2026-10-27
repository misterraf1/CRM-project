const MAP: Record<string, string> = { ə: "e", ı: "i", ö: "o", ü: "u", ş: "s", ç: "c", ğ: "g", İ: "i" };

/** "Bakı Tekstil MMC" → "baki-tekstil-mmc" (subdomain-safe, 3–40 chars). */
export function slugify(name: string) {
  const base = name
    .replace(/[əıöüşçğİ]/gi, (ch) => MAP[ch] ?? MAP[ch.toLowerCase()] ?? ch)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return base.length >= 3 ? base : `${base || "company"}-${Math.random().toString(36).slice(2, 6)}`;
}
