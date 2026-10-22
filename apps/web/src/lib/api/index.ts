import "server-only";
import type {
  ActivityDto,
  BillingOverviewDto,
  InvoiceDto,
  ChatRoomDetailDto,
  ChatRoomDto,
  ChatSearchHitDto,
  CannedResponseDto,
  ChannelDto,
  ConversationDetailDto,
  ConversationListItemDto,
  InboxMetricsDto,
  MemberProfileDto,
  MemberStatsDto,
  ProjectDto,
  ShellSummaryDto,
  TaskDetailDto,
  TaskDto,
  ContactDetailDto,
  ContactListResponse,
  DashboardCrmDto,
  DealDto,
  DepartmentDto,
  ForecastDto,
  MeResponse,
  MemberDto,
  PipelineDto,
} from "@axis/shared";
import { cache } from "react";
import { apiFetch } from "./server";
import { PERIODS, type Period, type ShellSummary } from "./types";

// Single entry point for server-side data: thin typed wrappers over the API.

export const getSession = cache(() => apiFetch<MeResponse>("/v1/me"));

export const getMembers = cache(() => apiFetch<MemberDto[]>("/v1/members"));

export const getDepartments = () => apiFetch<DepartmentDto[]>("/v1/departments");

export const getShellSummary = cache(async (): Promise<ShellSummary> => {
  const s = await apiFetch<ShellSummaryDto>("/v1/me/summary");
  return { awaiting: s.awaitingConversations, overdue: s.overdueTasks, unreadNotifications: s.unreadNotifications, unreadChat: s.unreadChat };
});

export const getDashboard = (period: Period) => apiFetch<DashboardCrmDto>(`/v1/dashboard?period=${period}`);

export function getContacts(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return apiFetch<ContactListResponse>(`/v1/contacts?${qs}`);
}

export const getContact = (id: string) => apiFetch<ContactDetailDto>(`/v1/contacts/${encodeURIComponent(id)}`);

export const getContactActivities = (id: string) => apiFetch<ActivityDto[]>(`/v1/contacts/${encodeURIComponent(id)}/activities`);

export const getPipelines = cache(() => apiFetch<PipelineDto[]>("/v1/pipelines"));

export function getDeals(params: { pipelineId?: string; q?: string }) {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return apiFetch<DealDto[]>(`/v1/deals?${qs}`);
}

export const getDeal = (id: string) => apiFetch<DealDto & { activities: ActivityDto[] }>(`/v1/deals/${encodeURIComponent(id)}`);

export const getForecast = (pipelineId?: string) =>
  apiFetch<ForecastDto>(`/v1/deals/forecast${pipelineId ? `?pipelineId=${encodeURIComponent(pipelineId)}` : ""}`);

function query(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return qs.size ? `?${qs}` : "";
}

export const getTasks = (params: Record<string, string | undefined>) => apiFetch<TaskDto[]>(`/v1/tasks${query(params)}`);

export const getTask = (id: string) => apiFetch<TaskDetailDto>(`/v1/tasks/${encodeURIComponent(id)}`);

export const getProjects = cache(() => apiFetch<ProjectDto[]>("/v1/projects"));

export const getTeamStats = (period: string) => apiFetch<MemberStatsDto[]>(`/v1/team/stats?period=${encodeURIComponent(period)}`);

export const getMemberProfile = (id: string) => apiFetch<MemberProfileDto>(`/v1/team/${encodeURIComponent(id)}`);

export const getConversations = (params: Record<string, string | undefined>) =>
  apiFetch<ConversationListItemDto[]>(`/v1/inbox/conversations${query(params)}`);

export const getConversation = (id: string) => apiFetch<ConversationDetailDto>(`/v1/inbox/conversations/${encodeURIComponent(id)}`);

export const getChannels = () => apiFetch<ChannelDto[]>("/v1/inbox/channels");

export const getTemplates = () => apiFetch<CannedResponseDto[]>("/v1/inbox/templates");

export const getInboxMetrics = () => apiFetch<InboxMetricsDto>("/v1/inbox/metrics");

export const getChatRooms = () => apiFetch<ChatRoomDto[]>("/v1/chat/rooms");

export const getChatRoom = (id: string, before?: string) =>
  apiFetch<ChatRoomDetailDto>(`/v1/chat/rooms/${encodeURIComponent(id)}${query({ before })}`);

export const searchChat = (q: string) => apiFetch<ChatSearchHitDto[]>(`/v1/chat/search${query({ q })}`);

export const getBilling = () => apiFetch<BillingOverviewDto>("/v1/billing");

export const getInvoice = (id: string) => apiFetch<InvoiceDto & { company: string; plan: string }>(`/v1/billing/invoices/${encodeURIComponent(id)}`);

export function parsePeriod(value: string | string[] | undefined): Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value) ? (value as Period) : "30d";
}
