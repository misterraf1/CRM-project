import type { ChatMessageDto, ChatRoomDetailDto, ChatRoomDto } from "@/shared";
import request from "supertest";
import { addMember, createApp, signup, type TestApp } from "./helpers";

type Who = { auth: Record<string, string>; memberId?: string };

describe("Team chat", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const rooms = async (who: Who) => (await http().get("/v1/chat/rooms").set(who.auth).expect(200)).body as ChatRoomDto[];
  const room = async (who: Who, id: string) => (await http().get(`/v1/chat/rooms/${id}`).set(who.auth).expect(200)).body as ChatRoomDetailDto;
  const say = (who: Who, id: string, body: Record<string, unknown>) => http().post(`/v1/chat/rooms/${id}/messages`).set(who.auth).send(body);
  const summary = async (who: Who) => (await http().get("/v1/me/summary").set(who.auth)).body.unreadChat as number;

  it("direct chat: one room per pair, unread counts, read marks", async () => {
    const owner = await signup(app);
    const a = await addMember(app, owner, "EMPLOYEE");
    const b = await addMember(app, owner, "EMPLOYEE");
    const r1 = (await http().post("/v1/chat/rooms/direct").set(a.auth).send({ memberId: b.memberId }).expect(201)).body.id;
    const r2 = (await http().post("/v1/chat/rooms/direct").set(b.auth).send({ memberId: a.memberId }).expect(201)).body.id;
    expect(r2).toBe(r1);
    await http().post("/v1/chat/rooms/direct").set(a.auth).send({ memberId: a.memberId }).expect(400);

    await say(a, r1, { body: "Salam, hesabat hazırdır?" }).expect(201);
    await say(a, r1, { body: "Cümə gününə lazımdır" }).expect(201);
    const forB = (await rooms(b)).find((r) => r.id === r1)!;
    expect(forB).toMatchObject({ kind: "direct", name: "Test EMPLOYEE", unread: 2, lastMessage: { body: "Cümə gününə lazımdır", mine: false } });
    expect((await rooms(a)).find((r) => r.id === r1)!.lastMessage).toMatchObject({ mine: true });
    expect(await summary(b)).toBe(2);
    expect(await summary(a)).toBe(0); // own messages are never unread

    await http().post(`/v1/chat/rooms/${r1}/read`).set(b.auth).expect(204);
    expect(await summary(b)).toBe(0);
    // Owner is not part of the pair
    await http().get(`/v1/chat/rooms/${r1}`).set(owner.auth).expect(404);
    await say(owner, r1, { body: "x" }).expect(404);
  });

  it("department room follows department membership", async () => {
    const owner = await signup(app);
    const m = await addMember(app, owner, "EMPLOYEE");
    const sales = (await http().post("/v1/departments").set(owner.auth).send({ name: "Satış" }).expect(201)).body;
    const support = (await http().post("/v1/departments").set(owner.auth).send({ name: "Dəstək" }).expect(201)).body;
    await http().patch(`/v1/members/${m.memberId}`).set(owner.auth).send({ departmentId: sales.id }).expect(200);

    const deptRoom = (await rooms(m)).find((r) => r.kind === "department")!;
    expect(deptRoom).toMatchObject({ name: "Satış", memberCount: 1 });
    await say(m, deptRoom.id, { body: "Bu həftənin planı" }).expect(201);

    // Moving to another department removes access to the old room's history
    await http().patch(`/v1/members/${m.memberId}`).set(owner.auth).send({ departmentId: support.id }).expect(200);
    await http().get(`/v1/chat/rooms/${deptRoom.id}`).set(m.auth).expect(404);
    const now = await rooms(m);
    expect(now.map((r) => r.name)).toEqual(["Dəstək"]);
    expect((await http().get("/v1/chat/search").query({ q: "planı" }).set(m.auth)).body).toEqual([]);
  });

  it("groups: create, add members, leave; non-members get 404", async () => {
    const owner = await signup(app);
    const a = await addMember(app, owner, "EMPLOYEE");
    const b = await addMember(app, owner, "EMPLOYEE");
    const g = (await http().post("/v1/chat/rooms").set(owner.auth).send({ name: "Layihə X", memberIds: [a.memberId] }).expect(201)).body.id;
    expect((await room(a, g)).members.map((x) => x.name).sort()).toEqual(["Test EMPLOYEE", "Test Sahib"]);
    await http().get(`/v1/chat/rooms/${g}`).set(b.auth).expect(404);

    await http().post(`/v1/chat/rooms/${g}/members`).set(a.auth).send({ memberIds: [b.memberId] }).expect(204);
    expect((await room(b, g)).memberCount).toBe(3);
    await http().delete(`/v1/chat/rooms/${g}/members/me`).set(b.auth).expect(204);
    await http().get(`/v1/chat/rooms/${g}`).set(b.auth).expect(404);
    await http().post("/v1/chat/rooms").set(owner.auth).send({ name: "x", memberIds: ["mem_nope"] }).expect(400);
  });

  it("cross-tenant: rooms, members and messages are unreachable", async () => {
    const a = await signup(app);
    const b = await signup(app);
    const bMember = await addMember(app, b, "EMPLOYEE");
    const bRoom = (await http().post("/v1/chat/rooms/direct").set(b.auth).send({ memberId: bMember.memberId }).expect(201)).body.id;
    const msg = (await say(b, bRoom, { body: "gizli" }).expect(201)).body as ChatMessageDto;
    await http().get(`/v1/chat/rooms/${bRoom}`).set(a.auth).expect(404);
    await http().post("/v1/chat/rooms/direct").set(a.auth).send({ memberId: bMember.memberId }).expect(400);
    await http().patch(`/v1/chat/messages/${msg.id}`).set(a.auth).send({ body: "x" }).expect(404);
    expect((await http().get("/v1/chat/search").query({ q: "gizli" }).set(a.auth)).body).toEqual([]);
  });

  it("edit and delete own messages only; history pagination", async () => {
    const owner = await signup(app);
    const a = await addMember(app, owner, "EMPLOYEE");
    const r = (await http().post("/v1/chat/rooms/direct").set(owner.auth).send({ memberId: a.memberId }).expect(201)).body.id;
    const mine = (await say(owner, r, { body: "Səhv yazdım" }).expect(201)).body as ChatMessageDto;
    await http().patch(`/v1/chat/messages/${mine.id}`).set(a.auth).send({ body: "hack" }).expect(403);
    const edited = (await http().patch(`/v1/chat/messages/${mine.id}`).set(owner.auth).send({ body: "Düzəltdim" }).expect(200)).body;
    expect(edited).toMatchObject({ body: "Düzəltdim", mine: true });
    expect(edited.editedAt).not.toBeNull();
    await http().delete(`/v1/chat/messages/${mine.id}`).set(a.auth).expect(403);
    await http().delete(`/v1/chat/messages/${mine.id}`).set(owner.auth).expect(204);

    for (let i = 0; i < 7; i++) await say(a, r, { body: `#${i}` }).expect(201);
    const page1 = (await http().get(`/v1/chat/rooms/${r}`).query({ limit: 5 }).set(owner.auth).expect(200)).body as ChatRoomDetailDto;
    expect(page1.messages.map((m) => m.body)).toEqual(["#2", "#3", "#4", "#5", "#6"]);
    expect(page1.hasMore).toBe(true);
    const page2 = (await http().get(`/v1/chat/rooms/${r}`).query({ limit: 5, before: page1.messages[0]!.id }).set(owner.auth)).body;
    expect(page2.messages.map((m: ChatMessageDto) => m.body)).toEqual(["#0", "#1"]);
    expect(page2.hasMore).toBe(false);
    await say(a, r, {}).expect(400);
  });

  it("task links are shown only to people who can see the task", async () => {
    const owner = await signup(app);
    const a = await addMember(app, owner, "EMPLOYEE");
    const b = await addMember(app, owner, "EMPLOYEE");
    const g = (await http().post("/v1/chat/rooms").set(a.auth).send({ name: "Komanda", memberIds: [b.memberId, (await http().get("/v1/me").set(owner.auth)).body.membership.id] }).expect(201)).body.id;
    const t = (await http().post("/v1/tasks").set(a.auth).send({ title: "A-nın tapşırığı" }).expect(201)).body;
    const foreign = (await http().post("/v1/tasks").set(owner.auth).send({ title: "Sahibin gizli işi" }).expect(201)).body;
    await say(a, g, { taskId: foreign.id }).expect(400); // a can't see it, so can't link it
    await say(a, g, { body: "Buna baxın", taskId: t.id }).expect(201);

    const seenByOwner = (await room(owner, g)).messages.at(-1)!;
    expect(seenByOwner.task).toEqual({ id: t.id, title: "A-nın tapşırığı", status: "TODO" });
    const seenByB = (await room(b, g)).messages.at(-1)!;
    expect(seenByB.task).toBeNull(); // b has no access to a's task
    expect(seenByB.body).toBe("Buna baxın");
  });

  it("files: upload into a room; only current members can download", async () => {
    const owner = await signup(app);
    const a = await addMember(app, owner, "EMPLOYEE");
    const b = await addMember(app, owner, "EMPLOYEE");
    const r = (await http().post("/v1/chat/rooms/direct").set(owner.auth).send({ memberId: a.memberId }).expect(201)).body.id;
    const m = await http().post(`/v1/chat/rooms/${r}/files`).set(owner.auth).field("body", "Müqavilə").attach("file", Buffer.from("PDF?"), "müqavilə.pdf").expect(201);
    expect(m.body).toMatchObject({ body: "Müqavilə", attachments: [{ name: "müqavilə.pdf", sizeBytes: 4 }] });
    const fileId = m.body.attachments[0].fileId;
    await http().get(`/v1/files/${fileId}`).set(a.auth).expect(200);
    await http().get(`/v1/files/${fileId}`).set(b.auth).expect(404);
    // Deleting the message removes the file
    await http().delete(`/v1/chat/messages/${m.body.id}`).set(owner.auth).expect(204);
    await http().get(`/v1/files/${fileId}`).set(a.auth).expect(404);
  });

  it("search finds messages in my rooms only", async () => {
    const owner = await signup(app);
    const a = await addMember(app, owner, "EMPLOYEE");
    const b = await addMember(app, owner, "EMPLOYEE");
    const ab = (await http().post("/v1/chat/rooms/direct").set(a.auth).send({ memberId: b.memberId }).expect(201)).body.id;
    await say(a, ab, { body: "Anbarda 20 ədəd qalıb" }).expect(201);
    const hitsB = (await http().get("/v1/chat/search").query({ q: "ANBAR" }).set(b.auth).expect(200)).body;
    expect(hitsB).toHaveLength(1);
    expect(hitsB[0]).toMatchObject({ room: { id: ab, kind: "direct", name: "Test EMPLOYEE" }, message: { body: "Anbarda 20 ədəd qalıb" } });
    expect((await http().get("/v1/chat/search").query({ q: "anbar" }).set(owner.auth)).body).toEqual([]);
    await http().get("/v1/chat/search").query({ q: "a" }).set(owner.auth).expect(400);
  });

  it("live events reach room members only", async () => {
    const owner = await signup(app);
    const a = await addMember(app, owner, "EMPLOYEE");
    const outsider = await addMember(app, owner, "EMPLOYEE");
    const r = (await http().post("/v1/chat/rooms/direct").set(owner.auth).send({ memberId: a.memberId }).expect(201)).body.id;
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((done) => server.listen(0, done));
    const port = (server.address() as { port: number }).port;
    const open = async (who: Who) => {
      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/stream`, { headers: who.auth, signal: controller.signal });
      const reader = res.body!.getReader();
      await reader.read(); // ": connected"
      return { reader, controller };
    };
    const member = await open(a);
    const other = await open(outsider);
    await say(owner, r, { body: "Canlı" }).expect(201);

    let text = "";
    while (!text.includes("data:")) text += new TextDecoder().decode((await member.reader.read()).value);
    expect(JSON.parse(text.slice(text.indexOf("data:") + 5).trim().split("\n")[0]!)).toEqual({ type: "message", roomId: r });

    // The outsider's stream stays silent
    const silent = await Promise.race([
      other.reader.read().then(() => "event"),
      new Promise((done) => setTimeout(() => done("silent"), 400)),
    ]);
    expect(silent).toBe("silent");
    member.controller.abort();
    other.controller.abort();
  });
});
