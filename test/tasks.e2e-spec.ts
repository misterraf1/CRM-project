import type { INestApplication } from "@nestjs/common";
import type { TaskDetailDto, TaskDto } from "@axis/shared";
import request from "supertest";
import { OverdueJob } from "../src/tasks/overdue.job";
import { nextOccurrence } from "../src/tasks/tasks.service";
import { addMember, createApp, setPlan, signup, withRawDb, type Company } from "./helpers";

type Who = { auth: Record<string, string> };

describe("Tasks, files, notifications, team", () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const task = (who: Who, body: Record<string, unknown>) => http().post("/v1/tasks").set(who.auth).send(body);
  const titles = async (who: Who, query: Record<string, string> = {}) =>
    ((await http().get("/v1/tasks").query(query).set(who.auth).expect(200)).body as TaskDto[]).map((t) => t.title).sort();
  const memberIdOf = async (owner: Company, email: string) =>
    (await http().get("/v1/members").set(owner.auth)).body.find((m: { email: string }) => m.email === email).id as string;
  const notifications = async (who: Who) => (await http().get("/v1/notifications").set(who.auth).expect(200)).body;

  /** Team with a department: manager + employee inside, another employee outside. */
  async function team() {
    const owner = await signup(app);
    const manager = await addMember(app, owner, "MANAGER");
    const inDept = await addMember(app, owner, "EMPLOYEE");
    const outside = await addMember(app, owner, "EMPLOYEE");
    const dept = (await http().post("/v1/departments").set(owner.auth).send({ name: "Satış" }).expect(201)).body;
    for (const m of [manager, inDept]) await http().patch(`/v1/members/${m.memberId}`).set(owner.auth).send({ departmentId: dept.id }).expect(200);
    return { owner, manager, inDept, outside };
  }

  it("create defaults to self-assigned; list views mine/created/all", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const t = (await task(owner, { title: "Hesabat", priority: "HIGH" }).expect(201)).body as TaskDto;
    expect(t).toMatchObject({ status: "TODO", priority: "HIGH", overdue: false, can: { edit: true, delete: true } });
    expect(t.assignee?.name).toBe("Test Sahib");
    await task(owner, { title: "İşçiyə", assigneeId: emp.memberId }).expect(201);

    expect(await titles(owner)).toEqual(["Hesabat"]);
    expect(await titles(owner, { view: "created" })).toEqual(["Hesabat", "İşçiyə"]);
    expect(await titles(owner, { view: "all" })).toEqual(["Hesabat", "İşçiyə"]);
    expect(await titles(emp)).toEqual(["İşçiyə"]);
    await task(owner, { title: "" }).expect(400);
    await task(owner, { title: "x", recurrence: "FREQ=HOURLY" }).expect(400);
  });

  it("visibility: owner all, manager department, employee own; outside scope is 404", async () => {
    const { owner, manager, inDept, outside } = await team();
    await task(owner, { title: "Owner self" }).expect(201);
    const deptTask = (await task(inDept, { title: "Dept emp" }).expect(201)).body as TaskDto;
    const other = (await task(outside, { title: "Outside emp" }).expect(201)).body as TaskDto;

    expect(await titles(owner, { view: "all" })).toEqual(["Dept emp", "Outside emp", "Owner self"]);
    expect(await titles(manager, { view: "all" })).toEqual(["Dept emp"]);
    expect(await titles(inDept, { view: "all" })).toEqual(["Dept emp"]);
    await http().get(`/v1/tasks/${other.id}`).set(manager.auth).expect(404);
    await http().patch(`/v1/tasks/${other.id}`).set(inDept.auth).send({ status: "DONE" }).expect(404);
    await http().post(`/v1/tasks/${other.id}/comments`).set(inDept.auth).send({ body: "x" }).expect(404);
    await http().get(`/v1/tasks/${deptTask.id}`).set(manager.auth).expect(200);
  });

  it("assignment rules: employees → self or own department; managers (assign_any) → anyone", async () => {
    const { owner, manager, inDept, outside } = await team();
    const managerId = await memberIdOf(owner, manager.email);
    await task(inDept, { title: "to manager", assigneeId: managerId }).expect(201);
    await task(inDept, { title: "to outsider", assigneeId: outside.memberId }).expect(403);
    await task(outside, { title: "no dept", assigneeId: inDept.memberId }).expect(403);
    await task(manager, { title: "to outsider", assigneeId: outside.memberId }).expect(201);
    await task(owner, { title: "ghost", assigneeId: "mem_nope" }).expect(400);
  });

  it("edit rights: assignee can work on it, a bystander in scope can only move status; delete is creator/manager", async () => {
    const { owner, manager, inDept } = await team();
    const t = (await task(manager, { title: "Görüş", assigneeId: inDept.memberId }).expect(201)).body as TaskDto;
    await http().patch(`/v1/tasks/${t.id}`).set(inDept.auth).send({ title: "Görüş (yeniləndi)", status: "IN_PROGRESS" }).expect(200);
    const listed = ((await http().get("/v1/tasks").set(inDept.auth)).body as TaskDto[])[0]!;
    expect(listed.can).toEqual({ edit: true, delete: false });
    await http().delete(`/v1/tasks/${t.id}`).set(inDept.auth).expect(403);
    await http().delete(`/v1/tasks/${t.id}`).set(owner.auth).expect(204);
  });

  it("subtasks, comments, completion → notifications to the right people", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const t = (await task(owner, { title: "Layihə", assigneeId: emp.memberId }).expect(201)).body as TaskDto;
    const sub = (await task(owner, { title: "Alt 1", parentId: t.id }).expect(201)).body as TaskDto;
    await task(owner, { title: "Alt 2", parentId: t.id }).expect(201);
    await task(owner, { title: "Nested", parentId: sub.id }).expect(400);
    await http().patch(`/v1/tasks/${sub.id}`).set(owner.auth).send({ status: "DONE" }).expect(200);

    // Subtasks don't clutter the main list, but are counted
    const list = (await http().get("/v1/tasks").query({ view: "all" }).set(owner.auth)).body as TaskDto[];
    expect(list.map((x) => x.title)).toEqual(["Layihə"]);
    expect(list[0]!.subtasks).toEqual({ done: 1, total: 2 });

    // The assignee got "assigned"; the creator didn't notify themselves
    expect((await notifications(emp)).items.map((n: { type: string }) => n.type)).toEqual(["task_assigned"]);
    expect((await notifications(owner)).unread).toBe(0);

    await http().post(`/v1/tasks/${t.id}/comments`).set(emp.auth).send({ body: "Başladım" }).expect(201);
    await http().patch(`/v1/tasks/${t.id}`).set(emp.auth).send({ status: "DONE" }).expect(200);
    const ownerInbox = await notifications(owner);
    expect(ownerInbox.items.map((n: { type: string }) => n.type)).toEqual(["task_completed", "task_comment"]);
    expect(ownerInbox.items[1].payload).toMatchObject({ title: "Layihə", actorName: "Test EMPLOYEE", excerpt: "Başladım" });

    const detail = (await http().get(`/v1/tasks/${t.id}`).set(owner.auth).expect(200)).body as TaskDetailDto;
    expect(detail.completedAt).not.toBeNull();
    expect(detail.subtaskItems.map((s) => s.title)).toEqual(["Alt 1", "Alt 2"]);
    expect(detail.commentItems[0]).toMatchObject({ body: "Başladım", author: { name: "Test EMPLOYEE" } });

    await http().post(`/v1/notifications/${ownerInbox.items[0].id}/read`).set(owner.auth).expect(204);
    expect((await notifications(owner)).unread).toBe(1);
    await http().post("/v1/notifications/read-all").set(owner.auth).expect(204);
    expect((await http().get("/v1/me/summary").set(owner.auth)).body.unreadNotifications).toBe(0);
    // Someone else's notification id is not found
    await http().post(`/v1/notifications/${ownerInbox.items[0].id}/read`).set(emp.auth).expect(404);
  });

  it("recurring task: completing it schedules the next one, once", async () => {
    const owner = await signup(app);
    const due = new Date("2030-01-15T09:00:00Z");
    const t = (await task(owner, { title: "Həftəlik hesabat", dueAt: due, recurrence: "FREQ=WEEKLY" }).expect(201)).body as TaskDto;
    await http().patch(`/v1/tasks/${t.id}`).set(owner.auth).send({ status: "DONE" }).expect(200);
    const open = (await http().get("/v1/tasks").set(owner.auth)).body as TaskDto[];
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ title: "Həftəlik hesabat", recurrence: "FREQ=WEEKLY", dueAt: "2030-01-22T09:00:00.000Z" });
    // Reopening and completing the old one again doesn't spawn a duplicate
    await http().patch(`/v1/tasks/${t.id}`).set(owner.auth).send({ status: "TODO" }).expect(200);
    await http().patch(`/v1/tasks/${t.id}`).set(owner.auth).send({ status: "DONE" }).expect(200);
    expect((await http().get("/v1/tasks").set(owner.auth)).body).toHaveLength(1);

    expect(nextOccurrence("FREQ=DAILY;INTERVAL=3", due).toISOString()).toBe("2030-01-18T09:00:00.000Z");
    expect(nextOccurrence("FREQ=MONTHLY", due).toISOString()).toBe("2030-02-15T09:00:00.000Z");
  });

  it("overdue job notifies assignee and creator exactly once; moving the due date re-arms it", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const past = new Date(Date.now() - 2 * 3600_000);
    const t = (await task(owner, { title: "Gecikən", assigneeId: emp.memberId, dueAt: past }).expect(201)).body as TaskDto;
    expect(t.overdue).toBe(true);

    const job = app.get(OverdueJob);
    expect(await job.run()).toBeGreaterThanOrEqual(1);
    await job.run();
    const types = async (who: Who) => (await notifications(who)).items.map((n: { type: string }) => n.type);
    expect((await types(emp)).filter((x: string) => x === "task_overdue")).toHaveLength(1);
    expect((await types(owner)).filter((x: string) => x === "task_overdue")).toHaveLength(1);
    expect((await http().get("/v1/me/summary").set(emp.auth)).body.overdueTasks).toBe(1);

    await http().patch(`/v1/tasks/${t.id}`).set(owner.auth).send({ dueAt: new Date(Date.now() - 60_000) }).expect(200);
    await job.run();
    expect((await types(emp)).filter((x: string) => x === "task_overdue")).toHaveLength(2);
    expect(await titles(owner, { view: "overdue" })).toEqual(["Gecikən"]);
  });

  it("tasks without a due date are never overdue (MongoDB orders null before any date)", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    await task(owner, { title: "Tarixsiz", assigneeId: emp.memberId }).expect(201);
    await task(owner, { title: "Gələcək", assigneeId: emp.memberId, dueAt: new Date(Date.now() + 86400_000) }).expect(201);
    expect(await titles(owner, { view: "overdue" })).toEqual([]);
    expect((await http().get("/v1/me/summary").set(emp.auth)).body.overdueTasks).toBe(0);
    const dash = (await http().get("/v1/dashboard").set(owner.auth).expect(200)).body;
    expect(dash.tasks).toMatchObject({ open: 2, overdue: 0, overdueItems: [] });
    const stats = (await http().get("/v1/team/stats").set(owner.auth)).body;
    expect(stats.find((r: { member: { id: string } }) => r.member.id === emp.memberId)).toMatchObject({ openTasks: 2, overdueTasks: 0 });
    // The background job ignores them too
    await app.get(OverdueJob).run();
    expect((await notifications(emp)).items.filter((n: { type: string }) => n.type === "task_overdue")).toEqual([]);
  });

  it("links to CRM: contact reminders; foreign contact ids rejected", async () => {
    const owner = await signup(app);
    const other = await signup(app);
    const c = (await http().post("/v1/contacts").set(owner.auth).send({ name: "Fərid" }).expect(201)).body;
    const foreign = (await http().post("/v1/contacts").set(other.auth).send({ name: "Yad" }).expect(201)).body;
    await task(owner, { title: "Fəridə zəng", contactId: c.id, dueAt: new Date(Date.now() + 86400_000) }).expect(201);
    await task(owner, { title: "x", contactId: foreign.id }).expect(400);
    const forContact = (await http().get("/v1/tasks").query({ contactId: c.id, view: "all" }).set(owner.auth)).body as TaskDto[];
    expect(forContact[0]).toMatchObject({ title: "Fəridə zəng", contact: { id: c.id, name: "Fərid" } });
  });

  describe("files", () => {
    it("upload, list, download (forced attachment), delete; other company can't reach it", async () => {
      const owner = await signup(app);
      const other = await signup(app);
      const t = (await task(owner, { title: "Sənəd" }).expect(201)).body as TaskDto;
      const up = await http()
        .post(`/v1/tasks/${t.id}/files`)
        .set(owner.auth)
        .attach("file", Buffer.from("<script>alert(1)</script>"), { filename: "../../etc/müqavilə.html", contentType: "text/html" })
        .expect(201);
      // Path parts are dropped, the Azerbaijani name survives intact
      expect(up.body).toMatchObject({ name: "müqavilə.html", sizeBytes: 25 });

      const detail = (await http().get(`/v1/tasks/${t.id}`).set(owner.auth)).body as TaskDetailDto;
      expect(detail.files).toBe(1);
      expect(detail.fileItems[0]!.id).toBe(up.body.id);

      const dl = await http().get(`/v1/files/${up.body.id}`).set(owner.auth).buffer(true).expect(200);
      expect(dl.headers["content-type"]).toBe("application/octet-stream");
      expect(dl.headers["content-disposition"]).toMatch(/^attachment; filename\*=UTF-8''/);
      expect(dl.headers["x-content-type-options"]).toBe("nosniff");
      expect(Buffer.from(dl.body).toString()).toBe("<script>alert(1)</script>");

      await http().get(`/v1/files/${up.body.id}`).set(other.auth).expect(404);
      await http().delete(`/v1/files/${up.body.id}`).set(other.auth).expect(404);
      await http().delete(`/v1/files/${up.body.id}`).set(owner.auth).expect(204);
      await http().get(`/v1/files/${up.body.id}`).set(owner.auth).expect(404);
    });

    it("enforces upload size and the plan's storage quota", async () => {
      const owner = await signup(app);
      const me = (await http().get("/v1/me").set(owner.auth)).body;
      const t = (await task(owner, { title: "Böyük" }).expect(201)).body as TaskDto;
      const big = await http().post(`/v1/tasks/${t.id}/files`).set(owner.auth).attach("file", Buffer.alloc(11 * 1024 * 1024), "big.bin");
      expect(big.status).toBe(413);
      expect(big.body.error.code).toBe("FILE_TOO_LARGE");

      // START plan = 2 048 MB; fill it up to 8 bytes below the limit
      await setPlan(me.tenant.id, "START");
      await withRawDb((db) =>
        db.fileObject.create({
          data: { tenantId: me.tenant.id, uploaderId: "x", key: `quota/${me.tenant.id}`, name: "filler", mimeType: "x", sizeBytes: 2048 * 1024 * 1024 - 8 },
        }),
      );
      const over = await http().post(`/v1/tasks/${t.id}/files`).set(owner.auth).attach("file", Buffer.from("hello world"), "a.txt");
      expect(over.status).toBe(402);
      expect(over.body.error.code).toBe("STORAGE_LIMIT");
      // A file that still fits is accepted
      await http().post(`/v1/tasks/${t.id}/files`).set(owner.auth).attach("file", Buffer.from("tiny"), "a.txt").expect(201);
    });
  });

  it("team stats and profile respect scope; dashboard counts real tasks", async () => {
    const { owner, manager, inDept, outside } = await team();
    await task(inDept, { title: "Gecikən", dueAt: new Date(Date.now() - 3600_000) }).expect(201);
    const done = (await task(inDept, { title: "Bitdi" }).expect(201)).body as TaskDto;
    await http().patch(`/v1/tasks/${done.id}`).set(inDept.auth).send({ status: "DONE" }).expect(200);

    const all = (await http().get("/v1/team/stats").set(owner.auth).expect(200)).body;
    expect(all).toHaveLength(4);
    const row = all.find((r: { member: { id: string } }) => r.member.id === inDept.memberId);
    expect(row).toMatchObject({ openTasks: 1, overdueTasks: 1, tasksDone: 1 });

    expect((await http().get("/v1/team/stats").set(manager.auth)).body).toHaveLength(2);
    expect((await http().get("/v1/team/stats").set(outside.auth)).body).toHaveLength(1);
    await http().get(`/v1/team/${inDept.memberId}`).set(outside.auth).expect(404);
    const profile = (await http().get(`/v1/team/${inDept.memberId}`).set(manager.auth).expect(200)).body;
    expect(profile).toMatchObject({ department: "Satış", openTasks: 1 });
    expect(profile.tasks.map((t: TaskDto) => t.title)).toEqual(["Gecikən"]);

    const dash = (await http().get("/v1/dashboard").set(owner.auth).expect(200)).body;
    expect(dash.tasks).toMatchObject({ open: 1, overdue: 1 });
    expect(dash.tasks.overdueItems[0]).toMatchObject({ title: "Gecikən", assignee: { id: inDept.memberId } });
    expect(dash.team.find((r: { member: { id: string } }) => r.member.id === inDept.memberId)).toMatchObject({ tasksDone: 1, tasksOverdue: 1 });
    // The outsider's dashboard doesn't include department work
    expect((await http().get("/v1/dashboard").set(outside.auth)).body.tasks).toMatchObject({ open: 0, overdue: 0 });
  });
});
