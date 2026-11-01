import type { Terms } from "@/shared";
import type { Dictionary } from "./dictionaries/az";
import type { Locale } from "./locales";

/**
 * The company's own words (e.g. "Patients" for "Customers") laid over the interface
 * text: menu, page titles and "new …" buttons. Words left blank keep the default.
 */
export function withTerms(t: Dictionary, locale: Locale, terms: Terms | undefined): Dictionary {
  const w = terms?.[locale];
  if (!w || !Object.keys(w).length) return t;
  const pick = (word: string | undefined, fallback: string) => word || fallback;
  return {
    ...t,
    nav: { ...t.nav, crm: pick(w.contacts, t.nav.crm), deals: pick(w.deals, t.nav.deals), orders: pick(w.orders, t.nav.orders) },
    crm: { ...t.crm, title: pick(w.contacts, t.crm.title), new: pick(w.newContact, t.crm.new) },
    deals: { ...t.deals, title: pick(w.deals, t.deals.title), new: pick(w.newDeal, t.deals.new), contact: pick(w.contact, t.deals.contact) },
    orders: { ...t.orders, title: pick(w.orders, t.orders.title), new: pick(w.newOrder, t.orders.new) },
    dashboard: { ...t.dashboard, quick: { ...t.dashboard.quick, contact: pick(w.contact, t.dashboard.quick.contact), deal: pick(w.deal, t.dashboard.quick.deal) } },
  };
}
