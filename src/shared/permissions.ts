// Permission catalog shared by API (enforcement) and web (hiding UI).
// The API always makes the final decision; the web only mirrors it.

export const MEMBER_ROLES = ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PERMISSIONS = [
  "dashboard.view_all",
  "contacts.view_all",
  "contacts.manage",
  "contacts.delete",
  "deals.delete",
  "deals.export",
  "inbox.view_all",
  "inbox.reply",
  "inbox.assign",
  "tasks.view_all",
    "tasks.assign_any",
  "members.view",
  "members.invite",
  "members.manage",
  "departments.manage",
  "channels.manage",
  "billing.manage",
  "analytics.view",
  "automations.manage",
  "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL.filter((p) => p !== "billing.manage"),
  MANAGER: [
    "contacts.manage",
    "inbox.reply",
    "inbox.assign",
    "tasks.assign_any",
    "members.view",
    "analytics.view",
  ],
  EMPLOYEE: ["inbox.reply", "members.view"],
};

/** Roles a member may assign to others. Only an owner can create owners. */
export function assignableRoles(actor: MemberRole): MemberRole[] {
  if (actor === "OWNER") return [...MEMBER_ROLES];
  if (actor === "ADMIN") return ["ADMIN", "MANAGER", "EMPLOYEE"];
  return [];
}

const isPermission = (value: string): value is Permission => (PERMISSIONS as readonly string[]).includes(value);

/**
 * Role defaults plus per-member overrides: "deals.export" grants, "-inbox.reply" revokes.
 * Unknown entries are ignored so a stale override can never grant anything.
 */
export function resolvePermissions(role: MemberRole, overrides: readonly string[] = []): Permission[] {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const raw of overrides) {
    const revoke = raw.startsWith("-");
    const name = revoke ? raw.slice(1) : raw.replace(/^\+/, "");
    if (!isPermission(name)) continue;
    if (revoke) set.delete(name);
    else set.add(name);
  }
  // Billing stays with owners regardless of overrides
  if (role !== "OWNER") set.delete("billing.manage");
  return PERMISSIONS.filter((p) => set.has(p));
}
