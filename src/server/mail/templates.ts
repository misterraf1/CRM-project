// Transactional email copy, az / en / ru. Plain-text first; the HTML version is the same
// text in a minimal, client-safe layout (no remote images, no tracking).

export type MailLocale = "az" | "en" | "ru";

export type MailTemplate =
  | { template: "invite"; vars: { company: string; inviter: string; link: string; days: number } }
  | { template: "password_reset"; vars: { link: string; minutes: number } }
  | { template: "invoice_paid"; vars: { company: string; number: string; amount: string; link: string } }
  | { template: "support_reply"; vars: { subject: string; link: string } };

type Copy = { subject: string; lines: string[]; action: string };

const COPY: Record<MailTemplate["template"], Record<MailLocale, (v: never) => Copy>> = {
  invite: {
    az: (v: { company: string; inviter: string; days: number }) => ({
      subject: `${v.company} sizi Axis-ə dəvət edir`,
      lines: [`${v.inviter} sizi ${v.company} şirkətinin iş mühitinə dəvət edib.`, `Link ${v.days} gün etibarlıdır.`],
      action: "Dəvəti qəbul et",
    }),
    en: (v: { company: string; inviter: string; days: number }) => ({
      subject: `${v.company} invites you to Axis`,
      lines: [`${v.inviter} invited you to the ${v.company} workspace.`, `The link is valid for ${v.days} days.`],
      action: "Accept the invitation",
    }),
    ru: (v: { company: string; inviter: string; days: number }) => ({
      subject: `${v.company} приглашает вас в Axis`,
      lines: [`${v.inviter} пригласил(а) вас в рабочее пространство ${v.company}.`, `Ссылка действует ${v.days} дн.`],
      action: "Принять приглашение",
    }),
  },
  password_reset: {
    az: (v: { minutes: number }) => ({
      subject: "Şifrənin bərpası",
      lines: ["Hesabınız üçün şifrənin bərpası istənilib.", `Link ${v.minutes} dəqiqə etibarlıdır və bir dəfə işləyir.`, "Bunu siz istəməmisinizsə, bu məktubu nəzərə almayın — şifrəniz dəyişməyəcək."],
      action: "Yeni şifrə təyin et",
    }),
    en: (v: { minutes: number }) => ({
      subject: "Reset your password",
      lines: ["A password reset was requested for your account.", `The link is valid for ${v.minutes} minutes and works once.`, "If you didn't ask for this, ignore this email — your password stays the same."],
      action: "Set a new password",
    }),
    ru: (v: { minutes: number }) => ({
      subject: "Восстановление пароля",
      lines: ["Для вашего аккаунта запрошено восстановление пароля.", `Ссылка действует ${v.minutes} мин. и работает один раз.`, "Если вы этого не делали, просто проигнорируйте письмо — пароль не изменится."],
      action: "Задать новый пароль",
    }),
  },
  invoice_paid: {
    az: (v: { company: string; number: string; amount: string }) => ({
      subject: `Ödəniş qəbul edildi — ${v.number}`,
      lines: [`${v.company} üçün ${v.amount} məbləğində ödəniş qəbul edildi.`, `Faktura: ${v.number}. Təşəkkür edirik!`],
      action: "Fakturaya bax",
    }),
    en: (v: { company: string; number: string; amount: string }) => ({
      subject: `Payment received — ${v.number}`,
      lines: [`We received a payment of ${v.amount} for ${v.company}.`, `Invoice: ${v.number}. Thank you!`],
      action: "View the invoice",
    }),
    ru: (v: { company: string; number: string; amount: string }) => ({
      subject: `Оплата получена — ${v.number}`,
      lines: [`Получена оплата ${v.amount} для ${v.company}.`, `Счёт: ${v.number}. Спасибо!`],
      action: "Открыть счёт",
    }),
  },
  support_reply: {
    az: (v: { subject: string }) => ({ subject: `Dəstək cavab verdi: ${v.subject}`, lines: [`«${v.subject}» müraciətinizə Axis dəstək komandası cavab yazdı.`], action: "Cavaba bax" }),
    en: (v: { subject: string }) => ({ subject: `Support replied: ${v.subject}`, lines: [`The Axis support team replied to your ticket “${v.subject}”.`], action: "Read the reply" }),
    ru: (v: { subject: string }) => ({ subject: `Поддержка ответила: ${v.subject}`, lines: [`Команда поддержки Axis ответила на ваше обращение «${v.subject}».`], action: "Посмотреть ответ" }),
  },
};

const FOOTER: Record<MailLocale, string> = {
  az: "Bu məktub Axis tərəfindən avtomatik göndərilib.",
  en: "This email was sent automatically by Axis.",
  ru: "Это письмо отправлено Axis автоматически.",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderMail(t: MailTemplate, locale: MailLocale) {
  const copy = (COPY[t.template][locale] as (v: MailTemplate["vars"]) => Copy)(t.vars);
  const link = (t.vars as { link: string }).link;
  const text = [...copy.lines, "", `${copy.action}: ${link}`, "", "—", FOOTER[locale]].join("\n");
  const html = `<!doctype html><html lang="${locale}"><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px"><tr><td style="padding:28px">
<p style="margin:0 0 20px;font-weight:700;font-size:18px">Axis</p>
${copy.lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(l)}</p>`).join("\n")}
<p style="margin:24px 0"><a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">${esc(copy.action)}</a></p>
<p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">${esc(link)}</p>
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#94a3b8">${esc(FOOTER[locale])}</p>
</td></tr></table></body></html>`;
  return { subject: copy.subject, text, html };
}

export const mailLocale = (l: string | null | undefined): MailLocale => (l === "EN" || l === "en" ? "en" : l === "RU" || l === "ru" ? "ru" : "az");
