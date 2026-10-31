/** Dashboard blocks a member can show or hide (Customise). */
export const DASHBOARD_WIDGETS = ["onboarding", "quick", "today", "kpis", "revenue", "pipeline", "team", "ai", "targets", "attention", "queue", "activity"] as const;
export type DashboardWidget = (typeof DASHBOARD_WIDGETS)[number];
/** Hidden blocks, per browser: a convenience the server reads, so nothing flickers */
export const DASHBOARD_COOKIE = "axis_dash_hidden";

export function hiddenWidgets(cookie: string | undefined): DashboardWidget[] {
  const all = new Set<string>(DASHBOARD_WIDGETS);
  return (cookie ?? "").split(".").filter((w): w is DashboardWidget => all.has(w));
}
