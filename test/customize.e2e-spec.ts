import type { ContactDto, CustomObjectDto, CustomRecordDto, DealDto, FieldDefinitionDto, MeResponse, PipelineDto, SavedViewDto } from "@/shared";
import request from "supertest";
import { addMember, createApp, signup, type TestApp } from "./helpers";

describe("Customisation: saved views, required fields per stage", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it("saved views: own ones, team ones by admins only, the page number dropped", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    let mine = (await http().post("/v1/views").set(emp.auth).send({ entity: "contacts", name: "İsti", query: "level=hot&page=3" }).expect(201)).body as SavedViewDto[];
    expect(mine).toEqual([expect.objectContaining({ name: "İsti", query: "level=hot", shared: false, mine: true })]);
    await http().post("/v1/views").set(emp.auth).send({ entity: "contacts", name: "Hamı", query: "", shared: true }).expect(403);
    await http().post("/v1/views").set(owner.auth).send({ entity: "contacts", name: "Bakı", query: "tag=baki", shared: true }).expect(201);
    mine = (await http().get("/v1/views").query({ entity: "contacts" }).set(emp.auth).expect(200)).body as SavedViewDto[];
    expect(mine.map((v) => [v.name, v.mine])).toEqual([["Bakı", false], ["İsti", true]]);
    // The owner sees only their own and the team ones
    expect(((await http().get("/v1/views").query({ entity: "contacts" }).set(owner.auth)).body as SavedViewDto[]).map((v) => v.name)).toEqual(["Bakı"]);
    await http().delete(`/v1/views/${mine[0]!.id}`).set(emp.auth).expect(403);
    expect(((await http().delete(`/v1/views/${mine[1]!.id}`).set(emp.auth).expect(200)).body as SavedViewDto[]).map((v) => v.name)).toEqual(["Bakı"]);
  });

  it("a stage can require deal fields before a deal enters it; losing a deal needs none", async () => {
    const owner = await signup(app);
    const contract = (await http().post("/v1/fields").set(owner.auth).send({ entity: "deal", label: "Müqavilə №", type: "text" }).expect(201)).body as FieldDefinitionDto;
    const pipeline = ((await http().get("/v1/pipelines").set(owner.auth)).body as PipelineDto[])[0]!;
    const target = pipeline.stages.filter((s) => s.kind === "open")[1]!;
    const lost = pipeline.stages.find((s) => s.kind === "lost")!;
    const stages = pipeline.stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, kind: s.kind, requiredFields: s.id === target.id ? [contract.id, "not-a-field"] : [] }));
    const saved = (await http().patch(`/v1/pipelines/${pipeline.id}/stages`).set(owner.auth).send({ stages }).expect(200)).body as PipelineDto;
    expect(saved.stages.find((s) => s.id === target.id)?.requiredFields).toEqual([contract.id]);

    const deal = (await http().post("/v1/deals").set(owner.auth).send({ title: "Ofis", amount: 1000, pipelineId: pipeline.id }).expect(201)).body as DealDto;
    const blocked = await http().post(`/v1/deals/${deal.id}/move`).set(owner.auth).send({ stageId: target.id }).expect(422);
    expect(blocked.body.error).toMatchObject({ code: "STAGE_FIELDS_REQUIRED", details: { fields: "Müqavilə №" } });
    await http().post(`/v1/deals/${deal.id}/move`).set(owner.auth).send({ stageId: lost.id, lostReason: "Baha" }).expect(200);
    await http().post(`/v1/deals/${deal.id}/move`).set(owner.auth).send({ stageId: pipeline.stages[0]!.id }).expect(200);
    await http().patch(`/v1/deals/${deal.id}`).set(owner.auth).send({ customFields: { [contract.id]: "M-17" } }).expect(200);
    await http().post(`/v1/deals/${deal.id}/move`).set(owner.auth).send({ stageId: target.id }).expect(200);
  });

  it("custom sections: fields, records linked to customers, archived fields keep their values, only empty sections go", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    const body = { name: "Avtomobillər", singular: "Avtomobil", icon: "car", fields: [{ label: "Marka", type: "select", options: ["BMW", "Kia"], required: true }, { label: "İl", type: "number" }] };
    await http().post("/v1/objects").set(emp.auth).send(body).expect(403);
    const cars = (await http().post("/v1/objects").set(owner.auth).send(body).expect(201)).body as CustomObjectDto;
    expect(((await http().get("/v1/me").set(emp.auth)).body as MeResponse).tenant.objects).toEqual([{ id: cars.id, name: "Avtomobillər", icon: "car" }]);
    const [brand, year] = cars.fields;

    const customer = (await http().post("/v1/contacts").set(emp.auth).send({ name: "Sürücü" }).expect(201)).body as ContactDto;
    await http().post(`/v1/objects/${cars.id}/records`).set(emp.auth).send({ title: "90-AA-001", values: { [year!.id]: 2020 } }).expect(400);
    await http().post(`/v1/objects/${cars.id}/records`).set(emp.auth).send({ title: "90-AA-001", values: { [brand!.id]: "Audi" } }).expect(400);
    const rec = (await http().post(`/v1/objects/${cars.id}/records`).set(emp.auth).send({ title: "90-AA-001", values: { [brand!.id]: "Kia", [year!.id]: 2020 }, contactId: customer.id }).expect(201)).body as CustomRecordDto;
    expect(rec).toMatchObject({ title: "90-AA-001", values: { [brand!.id]: "Kia", [year!.id]: 2020 }, contact: { id: customer.id, name: "Sürücü" } });
    const list = (await http().get(`/v1/objects/${cars.id}/records`).query({ q: "90-aa" }).set(owner.auth).expect(200)).body as { items: CustomRecordDto[]; total: number };
    expect(list.total).toBe(1);

    // A field dropped from the section is archived; the record keeps the value
    const edited = (await http().patch(`/v1/objects/${cars.id}`).set(owner.auth).send({ fields: [{ id: brand!.id, label: "Marka", type: "select", options: ["BMW", "Kia", "Toyota"], required: true }] }).expect(200)).body as CustomObjectDto;
    expect(edited.fields.map((f) => f.label)).toEqual(["Marka"]);
    expect(((await http().get(`/v1/records/${rec.id}`).set(owner.auth)).body as CustomRecordDto).values[year!.id]).toBe(2020);

    await http().delete(`/v1/objects/${cars.id}`).set(owner.auth).expect(409);
    await http().delete(`/v1/records/${rec.id}`).set(owner.auth).expect(204);
    await http().delete(`/v1/objects/${cars.id}`).set(owner.auth).expect(200);
    // Another company can't see them
    const other = await signup(app);
    await http().get(`/v1/records/${rec.id}`).set(other.auth).expect(404);
  });
});
