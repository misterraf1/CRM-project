import { resolvePermissions, type Permission } from "@/shared";
import type { Tx } from "../db/database";

/**
 * Members named with "@Full Name" in a text who may also see the record it belongs to
 * (so a mention never shows a note to someone who couldn't open it). `owners` are the
 * record's owners (contact owner; task assignee and creator); `viewAll` the permission
 * that shows every such record.
 */
export async function mentionedMembers(tx: Tx, tenantId: string, text: string, owners: (string | null)[], viewAll: Permission): Promise<string[]> {
  if (!text.includes("@")) return [];
  const members = await tx.membership.find({ tenantId, status: "ACTIVE" }, { projection: { id: 1, userId: 1, role: 1, roleId: 1, permissions: 1, departmentId: 1 } });
  const users = new Map((await tx.user.find({ id: { $in: members.map((m) => m.userId) } }, { projection: { id: 1, fullName: 1 } })).map((u) => [u.id, u.fullName]));
  const lower = text.toLocaleLowerCase();
  const named = members.filter((m) => {
    const name = users.get(m.userId)?.trim();
    return !!name && name.length >= 2 && lower.includes(`@${name.toLocaleLowerCase()}`);
  });
  if (!named.length) return [];

  const roleIds = [...new Set(named.map((m) => m.roleId).filter((x): x is string => !!x))];
  const roles = new Map((roleIds.length ? await tx.role.find({ tenantId, id: { $in: roleIds } }, { projection: { id: 1, permissions: 1 } }) : []).map((r) => [r.id, r.permissions]));
  const ownerIds = owners.filter((x): x is string => !!x);
  const ownerDepartments = new Set(members.filter((m) => ownerIds.includes(m.id)).map((m) => m.departmentId).filter(Boolean));

  return named
    .filter((m) => {
      const perms = resolvePermissions(m.role, m.permissions, m.roleId ? roles.get(m.roleId) : null);
      if (perms.includes(viewAll) || ownerIds.includes(m.id)) return true;
      // Department view: records of colleagues in the same department, and unassigned ones
      return perms.includes("records.view_department") && (!ownerIds.length || (!!m.departmentId && ownerDepartments.has(m.departmentId)));
    })
    .map((m) => m.id);
}
