import type { BusinessTemplateKey, HideableModule, Terms } from "@/shared";

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
  /** Menu sections this line of business rarely needs (set up only on the first-run choice) */
  hide: HideableModule[];
  /** The trade's own words for customers, deals and orders */
  terms?: Terms;
}

const l = (az: string, en: string, ru: string): L => ({ az, en, ru });

const won = l("Qazanıldı", "Won", "Выиграна");
const lost = l("İtirildi", "Lost", "Проиграна");
export const CLOSED_STAGES = [
  { name: won, probability: 100, kind: "won" as const },
  { name: lost, probability: 0, kind: "lost" as const },
];

const stages = (...s: [L, number][]) => s.map(([name, probability]) => ({ name, probability }));

/** Customer/deal/order words in all three languages: [singular, plural, "new …"] each. */
const words = (contact: [L, L, L], deal?: [L, L, L], order?: [L, L]): Terms => {
  const out: Terms = {};
  for (const lang of ["az", "en", "ru"] as const) {
    out[lang] = {
      contact: contact[0][lang],
      contacts: contact[1][lang],
      newContact: contact[2][lang],
      ...(deal && { deal: deal[0][lang], deals: deal[1][lang], newDeal: deal[2][lang] }),
      ...(order && { orders: order[0][lang], newOrder: order[1][lang] }),
    };
  }
  return out;
};

const unit = { service: l("xidmət", "service", "услуга"), piece: l("ədəd", "pcs", "шт."), month: l("ay", "month", "мес."), visit: l("seans", "session", "сеанс") };

/** Ready-made set-ups by line of business: pipeline, fields, order steps, catalog, rules, menu and words. */
export const BUSINESS_TEMPLATES: Record<BusinessTemplateKey, BusinessTemplate> = {
  production: {
    pipeline: l("Sifarişli istehsal", "Made to order", "Производство на заказ"),
    stages: stages([l("Müraciət", "Enquiry", "Обращение"), 10], [l("Ölçü", "Measurement", "Замер"), 30], [l("Təklif göndərildi", "Quote sent", "КП отправлено"), 50], [l("Avans", "Deposit", "Аванс"), 80]),
    fields: [
      { entity: "deal", label: l("Ünvan", "Address", "Адрес"), type: "text" },
      { entity: "deal", label: l("Ölçü tarixi", "Measurement date", "Дата замера"), type: "date" },
      { entity: "contact", label: l("Rayon", "District", "Район"), type: "text" },
    ],
    orderSteps: [l("Ölçü", "Measurement", "Замер"), l("İstehsal", "Production", "Производство"), l("Çatdırılma", "Delivery", "Доставка"), l("Quraşdırma", "Installation", "Монтаж")],
    products: [
      { name: l("Pəncərə (m²)", "Window (m²)", "Окно (м²)"), unit: l("m²", "m²", "м²"), price: 12_000 },
      { name: l("Quraşdırma", "Installation", "Монтаж"), unit: unit.service, price: 5_000 },
    ],
    automations: ["paid_won", "inactive_call"],
    hide: ["campaigns"],
  },
  agency: {
    pipeline: l("Agentlik layihələri", "Agency projects", "Проекты агентства"),
    stages: stages([l("Lead", "Lead", "Лид"), 10], [l("Brif", "Brief", "Бриф"), 30], [l("Təklif", "Proposal", "Предложение"), 50], [l("Müqavilə", "Contract", "Договор"), 80]),
    fields: [
      { entity: "deal", label: l("Xidmət növü", "Service", "Услуга"), type: "select", options: [l("SMM", "SMM", "SMM"), l("Sayt", "Website", "Сайт"), l("Reklam", "Ads", "Реклама")] },
      { entity: "deal", label: l("Aylıq büdcə", "Monthly budget", "Месячный бюджет"), type: "number" },
    ],
    orderSteps: [l("Brif", "Brief", "Бриф"), l("Dizayn", "Design", "Дизайн"), l("Təsdiq", "Approval", "Согласование"), l("Təhvil", "Handover", "Сдача")],
    products: [
      { name: l("SMM xidməti (aylıq)", "SMM (monthly)", "SMM (в месяц)"), unit: unit.month, price: 80_000, renewalMonths: 1 },
      { name: l("Sayt hazırlanması", "Website build", "Разработка сайта"), unit: l("layihə", "project", "проект"), price: 150_000 },
    ],
    automations: ["quote_thanks", "inactive_call"],
    hide: [],
    terms: words([l("Müştəri", "Client", "Клиент"), l("Müştərilər", "Clients", "Клиенты"), l("Yeni müştəri", "New client", "Новый клиент")], [l("Layihə", "Project", "Проект"), l("Layihələr", "Projects", "Проекты"), l("Yeni layihə", "New project", "Новый проект")]),
  },
  hosting: {
    pipeline: l("IT xidmətləri", "IT services", "IT-услуги"),
    stages: stages([l("Sorğu", "Request", "Запрос"), 10], [l("Texniki müzakirə", "Technical call", "Тех. обсуждение"), 30], [l("Təklif", "Quote", "Предложение"), 60]),
    fields: [{ entity: "contact", label: l("Domen", "Domain", "Домен"), type: "text" }],
    orderSteps: [l("Hesabın açılması", "Account set-up", "Создание аккаунта"), l("Köçürmə", "Migration", "Перенос"), l("Yoxlama", "Check", "Проверка")],
    products: [
      { name: l("Hosting (illik)", "Hosting (yearly)", "Хостинг (год)"), unit: l("il", "year", "год"), price: 12_000, renewalMonths: 12 },
      { name: l("Domen (illik)", "Domain (yearly)", "Домен (год)"), unit: l("il", "year", "год"), price: 3_000, renewalMonths: 12 },
    ],
    automations: ["paid_won"],
    hide: ["campaigns"],
  },
  services: {
    pipeline: l("Xidmət sifarişləri", "Service jobs", "Сервисные заявки"),
    stages: stages([l("Müraciət", "Request", "Заявка"), 20], [l("Baxış", "Inspection", "Осмотр"), 40], [l("Qiymət razılaşdırıldı", "Price agreed", "Цена согласована"), 70]),
    fields: [{ entity: "deal", label: l("Ünvan", "Address", "Адрес"), type: "text" }],
    orderSteps: [l("Baxış", "Inspection", "Осмотр"), l("İş", "Work", "Работа"), l("Təhvil", "Handover", "Сдача")],
    products: [{ name: l("Servis xidməti", "Service visit", "Выезд мастера"), unit: unit.visit, price: 4_000 }],
    automations: ["inactive_call"],
    hide: ["campaigns", "targets"],
    terms: words([l("Müştəri", "Customer", "Клиент"), l("Müştərilər", "Customers", "Клиенты"), l("Yeni müştəri", "New customer", "Новый клиент")], [l("Sifariş", "Job", "Заявка"), l("Sifarişlər", "Jobs", "Заявки"), l("Yeni sifariş", "New job", "Новая заявка")], [l("İcra", "Work orders", "Выполнение"), l("Yeni icra", "New work order", "Новое выполнение")]),
  },
  retail: {
    pipeline: l("Mağaza satışları", "Shop sales", "Продажи магазина"),
    stages: stages([l("Sorğu", "Enquiry", "Запрос"), 20], [l("Səbət", "Basket", "Корзина"), 50], [l("Ödəniş gözlənilir", "Awaiting payment", "Ожидает оплаты"), 80]),
    fields: [
      { entity: "contact", label: l("Doğum günü", "Birthday", "День рождения"), type: "date" },
      { entity: "contact", label: l("Endirim kartı", "Loyalty card", "Карта лояльности"), type: "text" },
      { entity: "deal", label: l("Çatdırılma ünvanı", "Delivery address", "Адрес доставки"), type: "text" },
    ],
    orderSteps: [l("Yığılır", "Picking", "Сборка"), l("Göndərildi", "Shipped", "Отправлен"), l("Çatdırıldı", "Delivered", "Доставлен")],
    products: [{ name: l("Məhsul nümunəsi", "Sample product", "Пример товара"), unit: unit.piece, price: 2_500 }],
    automations: ["paid_won", "inactive_call"],
    hide: ["cases", "targets"],
    terms: words([l("Alıcı", "Shopper", "Покупатель"), l("Alıcılar", "Shoppers", "Покупатели"), l("Yeni alıcı", "New shopper", "Новый покупатель")], [l("Sifariş", "Order", "Заказ"), l("Sifarişlər", "Orders", "Заказы"), l("Yeni sifariş", "New order", "Новый заказ")], [l("Çatdırılma", "Deliveries", "Доставка"), l("Yeni çatdırılma", "New delivery", "Новая доставка")]),
  },
  clinic: {
    pipeline: l("Pasiyent qəbulu", "Patient visits", "Приём пациентов"),
    stages: stages([l("Müraciət", "Enquiry", "Обращение"), 20], [l("Qəbula yazıldı", "Booked", "Записан"), 50], [l("Qəbulda oldu", "Visited", "Был на приёме"), 80]),
    fields: [
      { entity: "contact", label: l("Doğum tarixi", "Date of birth", "Дата рождения"), type: "date" },
      { entity: "deal", label: l("Həkim", "Doctor", "Врач"), type: "text" },
      { entity: "deal", label: l("Növbəti qəbul", "Next visit", "Следующий приём"), type: "date" },
    ],
    orderSteps: [l("Müayinə", "Examination", "Осмотр"), l("Müalicə", "Treatment", "Лечение"), l("Kontrol", "Follow-up", "Контроль")],
    products: [
      { name: l("Konsultasiya", "Consultation", "Консультация"), unit: unit.visit, price: 3_000 },
      { name: l("Müalicə seansı", "Treatment session", "Сеанс лечения"), unit: unit.visit, price: 6_000 },
    ],
    automations: ["inactive_call"],
    hide: ["campaigns", "targets", "sales"],
    terms: words([l("Pasiyent", "Patient", "Пациент"), l("Pasiyentlər", "Patients", "Пациенты"), l("Yeni pasiyent", "New patient", "Новый пациент")], [l("Qəbul", "Visit", "Приём"), l("Qəbullar", "Visits", "Приёмы"), l("Yeni qəbul", "New visit", "Новый приём")], [l("Müalicə planı", "Treatment plans", "Планы лечения"), l("Yeni müalicə planı", "New treatment plan", "Новый план лечения")]),
  },
  beauty: {
    pipeline: l("Salon qeydiyyatları", "Salon bookings", "Записи салона"),
    stages: stages([l("Müraciət", "Enquiry", "Обращение"), 30], [l("Qeydiyyat", "Booked", "Записан"), 60], [l("Gəldi", "Came in", "Пришёл"), 90]),
    fields: [
      { entity: "deal", label: l("Usta", "Specialist", "Мастер"), type: "text" },
      { entity: "contact", label: l("Doğum günü", "Birthday", "День рождения"), type: "date" },
    ],
    orderSteps: [l("Xidmət", "Service", "Услуга"), l("Ödəniş", "Payment", "Оплата")],
    products: [
      { name: l("Saç kəsimi", "Haircut", "Стрижка"), unit: unit.visit, price: 2_000 },
      { name: l("Manikür", "Manicure", "Маникюр"), unit: unit.visit, price: 2_500 },
    ],
    automations: ["inactive_call"],
    hide: ["sales", "orders", "cases", "targets"],
    terms: words([l("Müştəri", "Client", "Клиент"), l("Müştərilər", "Clients", "Клиенты"), l("Yeni müştəri", "New client", "Новый клиент")], [l("Qeydiyyat", "Booking", "Запись"), l("Qeydiyyatlar", "Bookings", "Записи"), l("Yeni qeydiyyat", "New booking", "Новая запись")]),
  },
  realestate: {
    pipeline: l("Əmlak satışı və icarə", "Property sales and rentals", "Продажа и аренда недвижимости"),
    stages: stages([l("Sorğu", "Enquiry", "Запрос"), 10], [l("Baxış", "Viewing", "Показ"), 30], [l("Danışıq", "Negotiation", "Переговоры"), 60], [l("Beh", "Deposit", "Задаток"), 85]),
    fields: [
      { entity: "deal", label: l("Obyekt ünvanı", "Property address", "Адрес объекта"), type: "text" },
      { entity: "deal", label: l("Sövdələşmə növü", "Deal type", "Тип сделки"), type: "select", options: [l("Satış", "Sale", "Продажа"), l("İcarə", "Rent", "Аренда")] },
      { entity: "contact", label: l("Büdcə", "Budget", "Бюджет"), type: "number" },
      { entity: "contact", label: l("Otaq sayı", "Rooms", "Комнат"), type: "number" },
    ],
    orderSteps: [l("Sənədlər", "Documents", "Документы"), l("Notarius", "Notary", "Нотариус"), l("Təhvil", "Handover", "Передача")],
    products: [{ name: l("Agent komissiyası", "Agent commission", "Комиссия агента"), unit: unit.service, price: 100_000 }],
    automations: ["inactive_call"],
    hide: ["campaigns"],
    terms: words([l("Müştəri", "Client", "Клиент"), l("Müştərilər", "Clients", "Клиенты"), l("Yeni müştəri", "New client", "Новый клиент")], [l("Obyekt", "Listing", "Объект"), l("Obyektlər", "Listings", "Объекты"), l("Yeni obyekt", "New listing", "Новый объект")]),
  },
  education: {
    pipeline: l("Kurs qeydiyyatı", "Course enrolment", "Запись на курсы"),
    stages: stages([l("Müraciət", "Enquiry", "Заявка"), 20], [l("Sınaq dərsi", "Trial lesson", "Пробный урок"), 50], [l("Qeydiyyat", "Enrolled", "Записан"), 85]),
    fields: [
      { entity: "deal", label: l("Kurs", "Course", "Курс"), type: "text" },
      { entity: "deal", label: l("Qrup", "Group", "Группа"), type: "text" },
      { entity: "contact", label: l("Valideyn", "Parent", "Родитель"), type: "text" },
    ],
    orderSteps: [l("Qrupa yerləşdirmə", "Group placement", "Распределение"), l("Təhsil", "Studies", "Обучение"), l("Sertifikat", "Certificate", "Сертификат")],
    products: [{ name: l("Kurs (aylıq)", "Course (monthly)", "Курс (в месяц)"), unit: unit.month, price: 15_000, renewalMonths: 1 }],
    automations: ["paid_won", "inactive_call"],
    hide: ["cases", "targets"],
    terms: words([l("Tələbə", "Student", "Студент"), l("Tələbələr", "Students", "Студенты"), l("Yeni tələbə", "New student", "Новый студент")], [l("Qeydiyyat", "Enrolment", "Запись"), l("Qeydiyyatlar", "Enrolments", "Записи"), l("Yeni qeydiyyat", "New enrolment", "Новая запись")]),
  },
  travel: {
    pipeline: l("Tur satışı", "Tour sales", "Продажа туров"),
    stages: stages([l("Sorğu", "Request", "Запрос"), 15], [l("Variantlar göndərildi", "Options sent", "Варианты отправлены"), 40], [l("Bron", "Booked", "Бронь"), 75]),
    fields: [
      { entity: "deal", label: l("İstiqamət", "Destination", "Направление"), type: "text" },
      { entity: "deal", label: l("Səfər tarixi", "Travel date", "Дата поездки"), type: "date" },
      { entity: "deal", label: l("Nəfər sayı", "Travellers", "Кол-во туристов"), type: "number" },
    ],
    orderSteps: [l("Bron", "Booking", "Бронь"), l("Viza", "Visa", "Виза"), l("Biletlər", "Tickets", "Билеты"), l("Səfər", "Trip", "Поездка")],
    products: [{ name: l("Tur paketi", "Tour package", "Турпакет"), unit: l("nəfər", "person", "чел."), price: 120_000 }],
    automations: ["quote_thanks", "inactive_call"],
    hide: ["cases", "targets"],
    terms: words([l("Turist", "Traveller", "Турист"), l("Turistlər", "Travellers", "Туристы"), l("Yeni turist", "New traveller", "Новый турист")], [l("Tur", "Tour", "Тур"), l("Turlar", "Tours", "Туры"), l("Yeni tur", "New tour", "Новый тур")]),
  },
  auto: {
    pipeline: l("Avtoservis", "Car service", "Автосервис"),
    stages: stages([l("Müraciət", "Request", "Заявка"), 20], [l("Diaqnostika", "Diagnostics", "Диагностика"), 45], [l("Təmir razılaşdırıldı", "Repair agreed", "Ремонт согласован"), 75]),
    fields: [
      { entity: "contact", label: l("Avtomobil", "Car", "Автомобиль"), type: "text" },
      { entity: "contact", label: l("Dövlət nömrəsi", "Plate number", "Госномер"), type: "text" },
      { entity: "deal", label: l("Yürüş (km)", "Mileage (km)", "Пробег (км)"), type: "number" },
    ],
    orderSteps: [l("Qəbul", "Check-in", "Приёмка"), l("Təmir", "Repair", "Ремонт"), l("Yoxlama", "Inspection", "Проверка"), l("Təhvil", "Handover", "Выдача")],
    products: [
      { name: l("Diaqnostika", "Diagnostics", "Диагностика"), unit: unit.service, price: 3_000 },
      { name: l("Yağ dəyişmə", "Oil change", "Замена масла"), unit: unit.service, price: 6_000, renewalMonths: 6 },
    ],
    automations: ["paid_won", "inactive_call"],
    hide: ["campaigns", "targets"],
    terms: words([l("Müştəri", "Customer", "Клиент"), l("Müştərilər", "Customers", "Клиенты"), l("Yeni müştəri", "New customer", "Новый клиент")], [l("Təmir", "Repair", "Ремонт"), l("Təmirlər", "Repairs", "Ремонты"), l("Yeni təmir", "New repair", "Новый ремонт")], [l("İş sifarişləri", "Work orders", "Заказ-наряды"), l("Yeni iş sifarişi", "New work order", "Новый заказ-наряд")]),
  },
  construction: {
    pipeline: l("Tikinti və təmir", "Construction and renovation", "Строительство и ремонт"),
    stages: stages([l("Müraciət", "Enquiry", "Обращение"), 10], [l("Obyektə baxış", "Site visit", "Выезд на объект"), 30], [l("Smeta", "Estimate", "Смета"), 50], [l("Müqavilə", "Contract", "Договор"), 80]),
    fields: [
      { entity: "deal", label: l("Obyekt ünvanı", "Site address", "Адрес объекта"), type: "text" },
      { entity: "deal", label: l("Sahə (m²)", "Area (m²)", "Площадь (м²)"), type: "number" },
    ],
    orderSteps: [l("Layihə", "Design", "Проект"), l("Material", "Materials", "Материалы"), l("İşlər", "Works", "Работы"), l("Təhvil", "Handover", "Сдача")],
    products: [{ name: l("Təmir işi (m²)", "Renovation (m²)", "Ремонт (м²)"), unit: l("m²", "m²", "м²"), price: 4_500 }],
    automations: ["paid_won", "inactive_call"],
    hide: ["campaigns"],
    terms: words([l("Sifarişçi", "Client", "Заказчик"), l("Sifarişçilər", "Clients", "Заказчики"), l("Yeni sifarişçi", "New client", "Новый заказчик")], [l("Obyekt", "Project", "Объект"), l("Obyektlər", "Projects", "Объекты"), l("Yeni obyekt", "New project", "Новый объект")]),
  },
  logistics: {
    pipeline: l("Yükdaşıma", "Freight", "Грузоперевозки"),
    stages: stages([l("Sorğu", "Request", "Запрос"), 15], [l("Qiymət verildi", "Rate quoted", "Ставка дана"), 45], [l("Təsdiq", "Confirmed", "Подтверждено"), 80]),
    fields: [
      { entity: "deal", label: l("Haradan", "From", "Откуда"), type: "text" },
      { entity: "deal", label: l("Haraya", "To", "Куда"), type: "text" },
      { entity: "deal", label: l("Çəki (kq)", "Weight (kg)", "Вес (кг)"), type: "number" },
    ],
    orderSteps: [l("Yükləmə", "Loading", "Погрузка"), l("Yolda", "In transit", "В пути"), l("Gömrük", "Customs", "Таможня"), l("Çatdırıldı", "Delivered", "Доставлено")],
    products: [{ name: l("Daşıma (reys)", "Haul (trip)", "Перевозка (рейс)"), unit: l("reys", "trip", "рейс"), price: 150_000 }],
    automations: ["paid_won"],
    hide: ["campaigns"],
    terms: words([l("Müştəri", "Shipper", "Клиент"), l("Müştərilər", "Shippers", "Клиенты"), l("Yeni müştəri", "New shipper", "Новый клиент")], [l("Daşıma", "Shipment", "Перевозка"), l("Daşımalar", "Shipments", "Перевозки"), l("Yeni daşıma", "New shipment", "Новая перевозка")], [l("Reyslər", "Trips", "Рейсы"), l("Yeni reys", "New trip", "Новый рейс")]),
  },
  restaurant: {
    pipeline: l("Banket və catering", "Banquets and catering", "Банкеты и кейтеринг"),
    stages: stages([l("Sorğu", "Enquiry", "Запрос"), 20], [l("Menyu təklifi", "Menu proposal", "Предложение меню"), 50], [l("Beh", "Deposit", "Предоплата"), 85]),
    fields: [
      { entity: "deal", label: l("Tədbir tarixi", "Event date", "Дата мероприятия"), type: "date" },
      { entity: "deal", label: l("Qonaq sayı", "Guests", "Кол-во гостей"), type: "number" },
    ],
    orderSteps: [l("Menyu", "Menu", "Меню"), l("Hazırlıq", "Preparation", "Подготовка"), l("Tədbir", "Event", "Мероприятие")],
    products: [{ name: l("Banket menyusu (nəfər)", "Banquet menu (guest)", "Банкетное меню (гость)"), unit: l("nəfər", "guest", "гость"), price: 4_000 }],
    automations: ["quote_thanks"],
    hide: ["cases", "targets"],
    terms: words([l("Qonaq", "Guest", "Гость"), l("Qonaqlar", "Guests", "Гости"), l("Yeni qonaq", "New guest", "Новый гость")], [l("Tədbir", "Event", "Мероприятие"), l("Tədbirlər", "Events", "Мероприятия"), l("Yeni tədbir", "New event", "Новое мероприятие")]),
  },
  legal: {
    pipeline: l("Hüquq və mühasibat xidməti", "Legal and accounting", "Юридические и бухгалтерские услуги"),
    stages: stages([l("Müraciət", "Enquiry", "Обращение"), 15], [l("Konsultasiya", "Consultation", "Консультация"), 40], [l("Müqavilə", "Engagement", "Договор"), 80]),
    fields: [
      { entity: "deal", label: l("İşin növü", "Matter type", "Тип дела"), type: "select", options: [l("Məhkəmə", "Litigation", "Суд"), l("Qeydiyyat", "Registration", "Регистрация"), l("Mühasibat", "Bookkeeping", "Бухучёт")] },
      { entity: "contact", label: l("VÖEN", "Tax ID", "ИНН"), type: "text" },
    ],
    orderSteps: [l("Sənədlər", "Documents", "Документы"), l("İcra", "Work", "Исполнение"), l("Hesabat", "Report", "Отчёт")],
    products: [
      { name: l("Konsultasiya (saat)", "Consultation (hour)", "Консультация (час)"), unit: l("saat", "hour", "час"), price: 5_000 },
      { name: l("Mühasibat xidməti (aylıq)", "Bookkeeping (monthly)", "Бухучёт (в месяц)"), unit: unit.month, price: 30_000, renewalMonths: 1 },
    ],
    automations: ["paid_won", "inactive_call"],
    hide: ["campaigns", "targets"],
    terms: words([l("Müştəri", "Client", "Клиент"), l("Müştərilər", "Clients", "Клиенты"), l("Yeni müştəri", "New client", "Новый клиент")], [l("İş", "Matter", "Дело"), l("İşlər", "Matters", "Дела"), l("Yeni iş", "New matter", "Новое дело")]),
  },
};
