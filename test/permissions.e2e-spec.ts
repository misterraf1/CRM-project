import { PERMISSION_GROUPS, PERMISSIONS, resolvePermissions } from "@/shared";

// Pins the role matrix (docs/ARCHITECTURE.md §6). A change here must be deliberate:
// a permission silently added to a role widens what every such member can see.
describe("Role permission matrix", () => {
  it("manager", () => {
    expect(resolvePermissions("MANAGER")).toEqual([
      "records.view_department",
      "contacts.create",
      "contacts.edit",
      "contacts.manage",
      "deals.create",
      "deals.edit",
      "quotes.manage",
      "inbox.reply",
      "inbox.assign",
      "tasks.create",
      "tasks.assign_any",
      "members.view",
      "analytics.view",
    ]);
  });

  it("employee", () => {
    expect(resolvePermissions("EMPLOYEE")).toEqual(["contacts.create", "contacts.edit", "deals.create", "deals.edit", "quotes.manage", "inbox.reply", "tasks.create", "members.view"]);
  });

  it("admin has everything except billing; owner has everything", () => {
    const admin = resolvePermissions("ADMIN");
    const owner = resolvePermissions("OWNER");
    expect(owner).toContain("billing.manage");
    expect(owner.filter((p) => !admin.includes(p))).toEqual(["billing.manage"]);
  });

  it("view-all permissions, roles, automation management and bulk import/export stay with owners and admins", () => {
    for (const p of ["dashboard.view_all", "contacts.view_all", "tasks.view_all", "automations.manage", "data.import", "contacts.export", "deals.export", "roles.manage", "products.manage", "invoices.manage", "finance.view"] as const) {
      expect(resolvePermissions("MANAGER")).not.toContain(p);
      expect(resolvePermissions("EMPLOYEE")).not.toContain(p);
      expect(resolvePermissions("ADMIN")).toContain(p);
    }
  });

  it("overrides grant and revoke, but never billing for non-owners", () => {
    expect(resolvePermissions("EMPLOYEE", ["deals.export", "-inbox.reply", "billing.manage", "made.up"])).toEqual([
      "contacts.create",
      "contacts.edit",
      "deals.create",
      "deals.edit",
      "deals.export",
      "quotes.manage",
      "tasks.create",
      "members.view",
    ]);
  });

  it("a custom role replaces the defaults; unknown entries and billing are dropped", () => {
    expect(resolvePermissions("EMPLOYEE", [], ["audit.view", "billing.manage", "made.up"])).toEqual(["audit.view"]);
    // Even an owner moved to a custom role has no billing through it
    expect(resolvePermissions("OWNER", [], ["billing.manage"])).toEqual([]);
  });

  it("the roles screen lists every permission exactly once", () => {
    const grouped = Object.values(PERMISSION_GROUPS).flat();
    expect([...grouped].sort()).toEqual([...PERMISSIONS].sort());
  });
});
