import "server-only";
import type {
  AdminInvoiceListResponse,
  AdminMe,
  AdminOverviewDto,
  AdminPlanDto,
  AdminTenantDetail,
  AdminTenantListResponse,
  AdminUsageRow,
  ExpenseDto,
  SystemHealthDto,
  TicketDto,
} from "@/shared";
import { cache } from "react";
import { query as qs } from "./index";
import { adminFetch } from "./server";

// Platform console reads (server components). Writes go through adminApi() in the browser.

export const getAdminMe = cache(() => adminFetch<AdminMe>("/auth/me"));
export const getAdminOverview = () => adminFetch<AdminOverviewDto>("/overview");
export const getAdminTenants = (p: { q?: string; status?: string; page?: string }) => adminFetch<AdminTenantListResponse>(`/tenants${qs(p)}`);
export const getAdminTenant = (id: string) => adminFetch<AdminTenantDetail>(`/tenants/${encodeURIComponent(id)}`);
export const getAdminPlans = () => adminFetch<AdminPlanDto[]>("/plans");
export const getAdminInvoices = (p: { status?: string; page?: string }) => adminFetch<AdminInvoiceListResponse>(`/invoices${qs(p)}`);
export const getAdminExpenses = () => adminFetch<ExpenseDto[]>("/expenses");
export const getAdminTickets = (status?: string) => adminFetch<TicketDto[]>(`/tickets${qs({ status })}`);
export const getAdminTicket = (id: string) => adminFetch<TicketDto>(`/tickets/${encodeURIComponent(id)}`);
export const getSystemHealth = () => adminFetch<SystemHealthDto>("/system");
export const getAdminUsage = () => adminFetch<AdminUsageRow[]>("/usage");
