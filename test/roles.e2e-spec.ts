import type { ContactListResponse, InviteCreatedResponse, MemberDto, RoleDto } from "@/shared";
import request from "supertest";
import { addMember, createApp, PASSWORD, signup, uniqueEmail, type Company, type TestApp } from "./helpers";

describe("Custom roles", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const createRole = async (who: { auth: { authorization: string } }, name: string, permissions: string[]) =>
    (await http().post("/v1/roles").set(who.auth).send({ name, permissions }).expect(201)).body as RoleDto;

  /** Invites with a custom role and accepts; returns the member's auth header. */
  async function memberWithRole(owner: Company, roleId: string) {
    const email = uniqueEmail("custom");
    const invite = (await http().post("/v1/members/invites").set(owner.auth).send({ email, roleId, fullName: "Rol Sınaq" }).expect(201)).body as InviteCreatedResponse;
    const token = invite.invitePath.replace("/invite/", "");
    const preview = await http().get(`/v1/invites/${token}`).expect(200);
    const accepted = await http().post(`/v1/invites/${token}/accept`).send({ password: PASSWORD }).expect(200);
    return { memberId: invite.member.id, member: invite.member, preview: preview.body, auth: { authorization: `Bearer ${accepted.body.accessToken}` } };
  }

  it("a custom role replaces the built-in permissions, and edits apply on the next request", async () => {
    const owner = await signup(app, "Rollar MMC");
    const viewer = await createRole(owner, "Müşahidəçi", ["members.view"]);
    expect(viewer).toMatchObject({ name: "Müşahidəçi", permissions: ["members.view"], members: 0 });

    const m = await memberWithRole(owner, viewer.id);
    expect(m.member).toMatchObject({ role: "EMPLOYEE", customRole: { id: viewer.id, name: "Müşahidəçi" } });
    expect(m.preview.customRole).toBe("Müşahidəçi");
    const me = (await http().get("/v1/me").set(m.auth).expect(200)).body;
    expect(me.membership.customRole).toEqual({ id: viewer.id, name: "Müşahidəçi" });
    expect(me.permissions).toEqual(["members.view"]);

    // A plain employee may create contacts; this role may not
    const denied = await http().post("/v1/contacts").set(m.auth).send({ name: "Bloklanmış" }).expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
    await http().post("/v1/tasks").set(m.auth).send({ title: "Tapşırıq" }).expect(403);

    await http().patch(`/v1/roles/${viewer.id}`).set(owner.auth).send({ name: "Müşahidəçi", permissions: ["members.view", "contacts.create"] }).expect(200);
    await http().post("/v1/contacts").set(m.auth).send({ name: "İcazəli" }).expect(201);

    const roles = (await http().get("/v1/roles").set(owner.auth).expect(200)).body as RoleDto[];
    expect(roles.find((r) => r.id === viewer.id)?.members).toBe(1);
    const audit = (await http().get("/v1/audit-logs").set(owner.auth).expect(200)).body as { action: string; diff: unknown }[];
    expect(audit.find((a) => a.action === "role.updated")?.diff).toEqual({ added: ["contacts.create"] });
  });

  it("built-in roles keep everyday rights: employees create and edit contacts, deals and tasks", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const contact = await http().post("/v1/contacts").set(emp.auth).send({ name: "Adi müştəri" }).expect(201);
    await http().patch(`/v1/contacts/${contact.body.id}`).set(emp.auth).send({ phone: "+994501112233" }).expect(200);
    await http().post(`/v1/contacts/${contact.body.id}/notes`).set(emp.auth).send({ body: "Qeyd" }).expect(201);
    await http().post("/v1/tasks").set(emp.auth).send({ title: "Zəng et" }).expect(201);
    const me = (await http().get("/v1/me").set(emp.auth)).body;
    expect(me.membership.customRole).toBeNull();
    expect(me.permissions).toEqual(expect.arrayContaining(["contacts.create", "contacts.edit", "deals.create", "deals.edit", "tasks.create"]));
  });

  it("nobody grants more than they have: roles, assignments and billing stay bounded", async () => {
    const owner = await signup(app);
    const manager = await addMember(app, owner, "MANAGER");
    await http().post("/v1/roles").set(manager.auth).send({ name: "Gizli", permissions: [] }).expect(403);

    // Billing can never be part of a role
    await http().post("/v1/roles").set(owner.auth).send({ name: "Mühasib", permissions: ["billing.manage"] }).expect(400);

    // A role manager without audit access can't create or hand out a role that has it
    const roleAdmin = await createRole(owner, "Rol meneceri", ["members.view", "members.invite", "members.manage", "roles.manage"]);
    const auditor = await createRole(owner, "Auditor", ["members.view", "audit.view"]);
    const ra = await memberWithRole(owner, roleAdmin.id);
    const escalated = await http().post("/v1/roles").set(ra.auth).send({ name: "Daha çox", permissions: ["audit.view"] }).expect(403);
    expect(escalated.body.error.message).toContain("audit.view");
    await http().patch(`/v1/roles/${auditor.id}`).set(ra.auth).send({ name: "Auditor 2", permissions: ["members.view", "audit.view"] }).expect(200);
    await http().patch(`/v1/roles/${auditor.id}`).set(ra.auth).send({ name: "Auditor 2", permissions: ["members.view"] }).expect(403);
    await http().post("/v1/members/invites").set(ra.auth).send({ email: uniqueEmail("x"), roleId: auditor.id }).expect(403);
    // …and can't hand out built-in roles either (they act as an employee for role rules)
    await http().post("/v1/members/invites").set(ra.auth).send({ email: uniqueEmail("x"), role: "ADMIN" }).expect(403);
    const ok = await http().post("/v1/members/invites").set(ra.auth).send({ email: uniqueEmail("x"), roleId: roleAdmin.id }).expect(201);
    expect(ok.body.member.customRole.name).toBe("Rol meneceri");
    // Not even onto themselves
    await http().patch(`/v1/members/${ra.memberId}`).set(ra.auth).send({ roleId: auditor.id }).expect(403);

    // Roles of another company don't exist here
    const other = await signup(app);
    const foreign = await createRole(other, "Xarici", ["members.view"]);
    const res = await http().post("/v1/members/invites").set(owner.auth).send({ email: uniqueEmail("x"), roleId: foreign.id }).expect(400);
    expect(res.body.error.details).toEqual({ roleId: ["Unknown role"] });
    await http().patch(`/v1/roles/${foreign.id}`).set(owner.auth).send({ name: "Oğurluq", permissions: [] }).expect(404);
  });

  it("switching roles: custom ↔ built-in, owners lose ownership only while another owner stays", async () => {
    const owner = await signup(app);
    const sales = await createRole(owner, "Satış", ["members.view", "contacts.create", "contacts.edit", "deals.create"]);
    const emp = await addMember(app, owner, "EMPLOYEE");

    const toCustom = (await http().patch(`/v1/members/${emp.memberId}`).set(owner.auth).send({ roleId: sales.id }).expect(200)).body as MemberDto;
    expect(toCustom).toMatchObject({ role: "EMPLOYEE", customRole: { id: sales.id, name: "Satış" } });
    expect((await http().get("/v1/me").set(emp.auth)).body.permissions).toEqual(["contacts.create", "contacts.edit", "deals.create", "members.view"]);

    // A title change keeps the role
    await http().patch(`/v1/members/${emp.memberId}`).set(owner.auth).send({ title: "Satıcı" }).expect(200);
    const list = (await http().get("/v1/members").set(owner.auth)).body as MemberDto[];
    expect(list.find((x) => x.id === emp.memberId)?.customRole?.name).toBe("Satış");

    const toManager = (await http().patch(`/v1/members/${emp.memberId}`).set(owner.auth).send({ role: "MANAGER" }).expect(200)).body as MemberDto;
    expect(toManager).toMatchObject({ role: "MANAGER", customRole: null });

    // The sole owner can't be moved to a custom role
    const ownerId = (await http().get("/v1/me").set(owner.auth)).body.membership.id;
    const second = await addMember(app, owner, "OWNER");
    const last = await http().patch(`/v1/members/${ownerId}`).set(second.auth).send({ roleId: sales.id }).expect(200);
    expect(last.body.role).toBe("EMPLOYEE");
    const blocked = await http().patch(`/v1/members/${second.memberId}`).set(owner.auth).send({ roleId: sales.id });
    expect(blocked.status).toBe(403);

    const audit = (await http().get("/v1/audit-logs").set(second.auth).expect(200)).body as { action: string; entityId: string; diff: Record<string, unknown> }[];
    expect(audit.find((a) => a.action === "member.updated" && a.entityId === ownerId)?.diff.role).toEqual({ from: "OWNER", to: "Satış" });
  });

  it("roles in use can't be deleted; names are unique per company", async () => {
    const owner = await signup(app);
    const r = await createRole(owner, "Operator", ["inbox.reply"]);
    await http().post("/v1/roles").set(owner.auth).send({ name: "operator", permissions: [] }).expect(409);
    const m = await memberWithRole(owner, r.id);

    const inUse = await http().delete(`/v1/roles/${r.id}`).set(owner.auth).expect(409);
    expect(inUse.body.error).toMatchObject({ code: "ROLE_IN_USE", details: { members: 1 } });

    await http().patch(`/v1/members/${m.memberId}`).set(owner.auth).send({ roleId: null }).expect(200);
    expect((await http().get("/v1/me").set(m.auth)).body.permissions).toEqual(["contacts.create", "contacts.edit", "deals.create", "deals.edit", "quotes.manage", "inbox.reply", "tasks.create", "members.view"]);
    await http().delete(`/v1/roles/${r.id}`).set(owner.auth).expect(204);
    expect((await http().get("/v1/roles").set(owner.auth)).body).toEqual([]);
  });

  it("department visibility comes from a permission, so a custom role can carry it", async () => {
    const owner = await signup(app);
    const lead = await createRole(owner, "Komanda lideri", ["members.view", "records.view_department", "contacts.create"]);
    const dept = (await http().post("/v1/departments").set(owner.auth).send({ name: "Şimal" }).expect(201)).body;
    const m = await memberWithRole(owner, lead.id);
    const colleague = await addMember(app, owner, "EMPLOYEE");
    const outsider = await addMember(app, owner, "EMPLOYEE");
    for (const id of [m.memberId, colleague.memberId]) await http().patch(`/v1/members/${id}`).set(owner.auth).send({ departmentId: dept.id }).expect(200);

    await http().post("/v1/contacts").set(colleague.auth).send({ name: "Komanda müştərisi" }).expect(201);
    await http().post("/v1/contacts").set(outsider.auth).send({ name: "Kənar müştəri" }).expect(201);

    const seen = (await http().get("/v1/contacts").set(m.auth).expect(200)).body as ContactListResponse;
    const names = seen.items.map((c) => c.name);
    expect(names).toContain("Komanda müştərisi");
    expect(names).not.toContain("Kənar müştəri");
  });
});
