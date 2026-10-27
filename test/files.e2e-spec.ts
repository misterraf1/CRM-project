import type { FileListResponse, TaskDto } from "@/shared";
import request from "supertest";
import { addMember, createApp, signup, type TestApp } from "./helpers";

describe("Files section", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  const list = async (who: { auth: Record<string, string> }, query: Record<string, string> = {}) =>
    (await http().get("/v1/files").query(query).set(who.auth).expect(200)).body as FileListResponse;
  const names = async (who: { auth: Record<string, string> }, query: Record<string, string> = {}) => (await list(who, query)).items.map((f) => f.name).sort();

  it("library, task and chat files — each visible exactly to who may open it", async () => {
    const owner = await signup(app);
    const emp1 = await addMember(app, owner, "EMPLOYEE");
    const emp2 = await addMember(app, owner, "EMPLOYEE");
    const other = await signup(app);

    const lib = (await http().post("/v1/files").set(owner.auth).attach("file", Buffer.from("Qaydalar"), "daxili-qaydalar.pdf").expect(201)).body;
    const task = (await http().post("/v1/tasks").set(emp1.auth).send({ title: "Şəxsi tapşırıq", assigneeId: emp1.memberId }).expect(201)).body as TaskDto;
    await http().post(`/v1/tasks/${task.id}/files`).set(emp1.auth).attach("file", Buffer.from("x"), "hesabat.xlsx").expect(201);
    const room = (await http().post("/v1/chat/rooms/direct").set(owner.auth).send({ memberId: emp1.memberId }).expect(201)).body.id;
    await http().post(`/v1/chat/rooms/${room}/files`).set(owner.auth).field("body", "Bax").attach("file", Buffer.from("y"), "müqavilə.docx").expect(201);

    expect(await names(owner)).toEqual(["daxili-qaydalar.pdf", "hesabat.xlsx", "müqavilə.docx"]);
    expect(await names(emp1)).toEqual(["daxili-qaydalar.pdf", "hesabat.xlsx", "müqavilə.docx"]);
    expect(await names(emp2)).toEqual(["daxili-qaydalar.pdf"]);
    expect(await names(other)).toEqual([]);

    const ownerView = await list(owner);
    expect(ownerView.items.find((f) => f.name === "hesabat.xlsx")?.source).toEqual({ type: "task", id: task.id, title: "Şəxsi tapşırıq" });
    expect(ownerView.storage.usedMb).toBeGreaterThanOrEqual(1);
    expect(ownerView.storage.limitMb).toBeGreaterThan(1000);

    expect(await names(emp1, { source: "chat" })).toEqual(["müqavilə.docx"]);
    expect(await names(emp1, { q: "QAYDA" })).toEqual(["daxili-qaydalar.pdf"]);

    // Library files open for any member, not for other companies
    await http().get(`/v1/files/${lib.id}`).set(emp2.auth).expect(200);
    await http().get(`/v1/files/${lib.id}`).set(other.auth).expect(404);
  });

  it("library deletion: the uploader, owners and admins", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const mine = (await http().post("/v1/files").set(emp.auth).attach("file", Buffer.from("a"), "işçi.txt").expect(201)).body;
    const ownerFile = (await http().post("/v1/files").set(owner.auth).attach("file", Buffer.from("b"), "sahib.txt").expect(201)).body;

    const view = await list(emp);
    expect(view.items.find((f) => f.id === mine.id)?.canDelete).toBe(true);
    expect(view.items.find((f) => f.id === ownerFile.id)?.canDelete).toBe(false);
    await http().delete(`/v1/files/${ownerFile.id}`).set(emp.auth).expect(403);
    await http().delete(`/v1/files/${mine.id}`).set(emp.auth).expect(204);

    const again = (await http().post("/v1/files").set(emp.auth).attach("file", Buffer.from("c"), "yenə.txt").expect(201)).body;
    await http().delete(`/v1/files/${again.id}`).set(owner.auth).expect(204);
    expect(await names(owner)).toEqual(["sahib.txt"]);
  });
});
