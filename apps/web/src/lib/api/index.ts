import "server-only";
import type { DepartmentDto, MeResponse, MemberDto } from "@axis/shared";
import { cache } from "react";
import { demoDashboard, demoShellSummary } from "./demo-data";
import { apiFetch } from "./server";
import { PERIODS, type DashboardData, type Period, type ShellSummary } from "./types";

// Single entry point for server-side data. Identity, members and departments are
// real API calls; dashboard figures and sidebar counters stay on the demo source
// until CRM (Phase 2), tasks (Phase 3) and inbox (Phase 4) ship.

export const getSession = cache(() => apiFetch<MeResponse>("/v1/me"));

export const getMembers = () => apiFetch<MemberDto[]>("/v1/members");

export const getDepartments = () => apiFetch<DepartmentDto[]>("/v1/departments");

export const getShellSummary = cache(async (): Promise<ShellSummary> => demoShellSummary(new Date()));

export async function getDashboard(period: Period): Promise<DashboardData> {
  return demoDashboard(period, new Date());
}

export function parsePeriod(value: string | string[] | undefined): Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value) ? (value as Period) : "30d";
}
