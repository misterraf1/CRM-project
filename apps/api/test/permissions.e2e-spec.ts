import { resolvePermissions } from "@axis/shared";

// Pins the role matrix (docs/ARCHITECTURE.md §6). A change here must be deliberate:
// a permission silently added to a role widens what every such member can see.
describe("Role permission matrix", () => {
  it("manager", () => {
    expect(resolvePermissions("MANAGER")).toEqual([
      "contacts.manage",
      "inbox.reply",
      "inbox.assign",
      "tasks.assign_any",
      "members.view",
      "analytics.view",
    ]);
  });

  it("employee", () => {
    expect(resolvePermissions("EMPLOYEE")).toEqual(["inbox.reply", "members.view"]);
  });

  it("admin has everything except billing; owner has everything", () => {
    const admin = resolvePermissions("ADMIN");
    const owner = resolvePermissions("OWNER");
    expect(owner).toContain("billing.manage");
    expect(owner.filter((p) => !admin.includes(p))).toEqual(["billing.manage"]);
  });

  it("view-all permissions stay with owners and admins", () => {
    for (const p of ["dashboard.view_all", "contacts.view_all", "tasks.view_all"] as const) {
      expect(resolvePermissions("MANAGER")).not.toContain(p);
      expect(resolvePermissions("EMPLOYEE")).not.toContain(p);
      expect(resolvePermissions("ADMIN")).toContain(p);
    }
  });

  it("overrides grant and revoke, but never billing for non-owners", () => {
    expect(resolvePermissions("EMPLOYEE", ["deals.export", "-inbox.reply", "billing.manage", "made.up"])).toEqual(["deals.export", "members.view"]);
  });
});
