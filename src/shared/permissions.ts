import { z } from "zod";

// Permission catalog shared by API (enforcement) and web (hiding UI).
// The API always makes the final decision; the web only mirrors it.

export const MEMBER_ROLES = ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PERMISSIONS = [
  "dashboard.view_all",
  "contacts.view_all",
  /** Records of the member's own department plus unassigned ones (managers) */
  "records.view_department",
  "contacts.create",
  "contacts.edit",
  "contacts.manage",
  "contacts.delete",
  "deals.create",
  "deals.edit",
  "deals.delete",
  "deals.export",
  /** Contacts list to CSV/Excel */
  "contacts.export",
  /** People, companies and deals from CSV/Excel */
  "data.import",
  "inbox.view_all",
  "inbox.reply",
  "inbox.assign",
  "tasks.view_all",
  "tasks.create",
  "tasks.assign_any",
  "members.view",
  "members.invite",
  "members.manage",
  /** Custom roles and their permissions */
  "roles.manage",
  "departments.manage",
  "channels.manage",
  "billing.manage",
  "analytics.view",
  "automations.manage",
  /** Pipelines and stages, custom fields, currency rates */
  "crm.configure",
  "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** How the roles screen groups the catalog. Every permission appears in exactly one group. */
export const PERMISSION_GROUPS = {
  visibility: ["dashboard.view_all", "contacts.view_all", "inbox.view_all", "tasks.view_all", "records.view_department"],
  crm: ["contacts.create", "contacts.edit", "contacts.manage", "contacts.delete", "deals.create", "deals.edit", "deals.delete"],
  data: ["contacts.export", "deals.export", "data.import"],
  work: ["inbox.reply", "inbox.assign", "tasks.create", "tasks.assign_any", "analytics.view", "automations.manage"],
  admin: ["members.view", "members.invite", "members.manage", "roles.manage", "departments.manage", "channels.manage", "crm.configure", "audit.view", "billing.manage"],
} as const satisfies Record<string, readonly Permission[]>;

const ALL: readonly Permission[] = PERMISSIONS;

/** Everyday work every built-in role has: creating and editing the records they can see. */
const EVERYDAY: readonly Permission[] = ["contacts.create", "contacts.edit", "deals.create", "deals.edit", "tasks.create"];

export const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL.filter((p) => p !== "billing.manage"),
  MANAGER: [
    ...EVERYDAY,
    "records.view_department",
    "contacts.manage",
    "inbox.reply",
    "inbox.assign",
    "tasks.assign_any",
    "members.view",
    "analytics.view",
  ],
  EMPLOYEE: [...EVERYDAY, "inbox.reply", "members.view"],
};

/** Billing stays with owners: no custom role or override can carry it. */
export const ROLE_GRANTABLE: readonly Permission[] = ALL.filter((p) => p !== "billing.manage");

/** Roles a member may assign to others. Only an owner can create owners. */
export function assignableRoles(actor: MemberRole): MemberRole[] {
  if (actor === "OWNER") return [...MEMBER_ROLES];
  if (actor === "ADMIN") return ["ADMIN", "MANAGER", "EMPLOYEE"];
  return [];
}

const isPermission = (value: string): value is Permission => (PERMISSIONS as readonly string[]).includes(value);

/**
 * Role defaults plus per-member overrides: "deals.export" grants, "-inbox.reply" revokes.
 * A custom role replaces the built-in defaults with its own list (`custom`).
 * Unknown entries are ignored so a stale override can never grant anything.
 */
export function resolvePermissions(role: MemberRole, overrides: readonly string[] = [], custom?: readonly string[] | null): Permission[] {
  const set = new Set<Permission>(custom ? custom.filter(isPermission) : ROLE_PERMISSIONS[role]);
  for (const raw of overrides) {
    const revoke = raw.startsWith("-");
    const name = revoke ? raw.slice(1) : raw.replace(/^\+/, "");
    if (!isPermission(name)) continue;
    if (revoke) set.delete(name);
    else set.add(name);
  }
  // Billing stays with owners regardless of overrides
  if (role !== "OWNER" || custom) set.delete("billing.manage");
  return PERMISSIONS.filter((p) => set.has(p));
}

// ─── Custom roles ────────────────────────────────────────────────

export const roleSchema = z.object({
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).nullish(),
  permissions: z.array(z.enum(ROLE_GRANTABLE as [Permission, ...Permission[]])).max(PERMISSIONS.length),
});
export type RoleInput = z.infer<typeof roleSchema>;

export interface RoleDto {
  id: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  /** Members (active or invited) holding the role */
  members: number;
  createdAt: string;
}
