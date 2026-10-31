import type { BusinessTemplateKey } from "@/shared";

type L = { az: string; en: string; ru: string };
type FieldSpec = { entity: "contact" | "deal"; label: L; type: "text" | "select" | "number" | "date"; options?: L[] };

export interface BusinessTemplate {
  pipeline: L;
  /** Open stages in order (won/lost are added at the end) */
  stages: { name: L; probability: number }[];
  fields: FieldSpec[];
  orderSteps: L[];
  products: { name: L; unit: L; price: number; renewalMonths?: number }[];
  /** Rules created disabled: the company switches on what fits */
  automations: ("inactive_call" | "paid_won" | "quote_thanks")[];
}

const won: L = { az: "Qazanıldı", en: "Won", ru: "Выиграна" };
const lost: L = { az: "İtirildi", en: "Lost", ru: "Проиграна" };
export const CLOSED_STAGES = [
  { name: won, probability: 100, kind: "won" as const },
  { name: lost, probability: 0, kind: "lost" as const },
];

/** Ready-made set-ups by line of business: pipeline, fields, order steps, catalog, rules. */
export const BUSINESS_TEMPLATES: Record<BusinessTemplateKey, BusinessTemplate> = {
  production: {
    pipeline: { az: "Sifarişli istehsal", en: "Made to order", ru: "Производство на заказ" },
    stages: [
      { name: { az: "Müraciət", en: "Enquiry", ru: "Обращение" }, probability: 10 },
      { name: { az: "Ölçü", en: "Measurement", ru: "Замер" }, probability: 30 },
      { name: { az: "Təklif göndərildi", en: "Quote sent", ru: "КП отправлено" }, probability: 50 },
      { name: { az: "Avans", en: "Deposit", ru: "Аванс" }, probability: 80 },
    ],
    fields: [
      { entity: "deal", label: { az: "Ünvan", en: "Address", ru: "Адрес" }, type: "text" },
      { entity: "deal", label: { az: "Ölçü tarixi", en: "Measurement date", ru: "Дата замера" }, type: "date" },
      { entity: "contact", label: { az: "Rayon", en: "District", ru: "Район" }, type: "text" },
    ],
    orderSteps: [
      { az: "Ölçü", en: "Measurement", ru: "Замер" },
      { az: "İstehsal", en: "Production", ru: "Производство" },
      { az: "Çatdırılma", en: "Delivery", ru: "Доставка" },
      { az: "Quraşdırma", en: "Installation", ru: "Монтаж" },
    ],
    products: [
      { name: { az: "Pəncərə (m²)", en: "Window (m²)", ru: "Окно (м²)" }, unit: { az: "m²", en: "m²", ru: "м²" }, price: 12_000 },
      { name: { az: "Quraşdırma", en: "Installation", ru: "Монтаж" }, unit: { az: "xidmət", en: "service", ru: "услуга" }, price: 5_000 },
    ],
    automations: ["paid_won", "inactive_call"],
  },
  agency: {
    pipeline: { az: "Agentlik layihələri", en: "Agency projects", ru: "Проекты агентства" },
    stages: [
      { name: { az: "Lead", en: "Lead", ru: "Лид" }, probability: 10 },
      { name: { az: "Brif", en: "Brief", ru: "Бриф" }, probability: 30 },
      { name: { az: "Təklif", en: "Proposal", ru: "Предложение" }, probability: 50 },
      { name: { az: "Müqavilə", en: "Contract", ru: "Договор" }, probability: 80 },
    ],
    fields: [
      { entity: "deal", label: { az: "Xidmət növü", en: "Service", ru: "Услуга" }, type: "select", options: [{ az: "SMM", en: "SMM", ru: "SMM" }, { az: "Sayt", en: "Website", ru: "Сайт" }, { az: "Reklam", en: "Ads", ru: "Реклама" }] },
      { entity: "deal", label: { az: "Aylıq büdcə", en: "Monthly budget", ru: "Месячный бюджет" }, type: "number" },
    ],
    orderSteps: [
      { az: "Brif", en: "Brief", ru: "Бриф" },
      { az: "Dizayn", en: "Design", ru: "Дизайн" },
      { az: "Təsdiq", en: "Approval", ru: "Согласование" },
      { az: "Təhvil", en: "Handover", ru: "Сдача" },
    ],
    products: [
      { name: { az: "SMM xidməti (aylıq)", en: "SMM (monthly)", ru: "SMM (в месяц)" }, unit: { az: "ay", en: "month", ru: "мес." }, price: 80_000, renewalMonths: 1 },
      { name: { az: "Sayt hazırlanması", en: "Website build", ru: "Разработка сайта" }, unit: { az: "layihə", en: "project", ru: "проект" }, price: 150_000 },
    ],
    automations: ["quote_thanks", "inactive_call"],
  },
  hosting: {
    pipeline: { az: "IT xidmətləri", en: "IT services", ru: "IT-услуги" },
    stages: [
      { name: { az: "Sorğu", en: "Request", ru: "Запрос" }, probability: 10 },
      { name: { az: "Texniki müzakirə", en: "Technical call", ru: "Тех. обсуждение" }, probability: 30 },
      { name: { az: "Təklif", en: "Quote", ru: "Предложение" }, probability: 60 },
    ],
    fields: [{ entity: "contact", label: { az: "Domen", en: "Domain", ru: "Домен" }, type: "text" }],
    orderSteps: [
      { az: "Hesabın açılması", en: "Account set-up", ru: "Создание аккаунта" },
      { az: "Köçürmə", en: "Migration", ru: "Перенос" },
      { az: "Yoxlama", en: "Check", ru: "Проверка" },
    ],
    products: [
      { name: { az: "Hosting (illik)", en: "Hosting (yearly)", ru: "Хостинг (год)" }, unit: { az: "il", en: "year", ru: "год" }, price: 12_000, renewalMonths: 12 },
      { name: { az: "Domen (illik)", en: "Domain (yearly)", ru: "Домен (год)" }, unit: { az: "il", en: "year", ru: "год" }, price: 3_000, renewalMonths: 12 },
    ],
    automations: ["paid_won"],
  },
  services: {
    pipeline: { az: "Xidmət sifarişləri", en: "Service jobs", ru: "Сервисные заявки" },
    stages: [
      { name: { az: "Müraciət", en: "Request", ru: "Заявка" }, probability: 20 },
      { name: { az: "Baxış", en: "Inspection", ru: "Осмотр" }, probability: 40 },
      { name: { az: "Qiymət razılaşdırıldı", en: "Price agreed", ru: "Цена согласована" }, probability: 70 },
    ],
    fields: [{ entity: "deal", label: { az: "Ünvan", en: "Address", ru: "Адрес" }, type: "text" }],
    orderSteps: [
      { az: "Baxış", en: "Inspection", ru: "Осмотр" },
      { az: "İş", en: "Work", ru: "Работа" },
      { az: "Təhvil", en: "Handover", ru: "Сдача" },
    ],
    products: [{ name: { az: "Servis xidməti", en: "Service visit", ru: "Выезд мастера" }, unit: { az: "xidmət", en: "visit", ru: "выезд" }, price: 4_000 }],
    automations: ["inactive_call"],
  },
};
