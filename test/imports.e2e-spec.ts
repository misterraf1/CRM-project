import type { ContactDto, DealDto, FieldDefinitionDto, ImportJobDetailDto, ImportJobDto, ImportPreviewDto, PipelineDto } from "@/shared";
import request from "supertest";
import { readXlsx, toXlsx } from "../src/server/common/tabular";
import { addMember, createApp, signup, withRawDb, type TestApp } from "./helpers";

describe("CSV/Excel import and export", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  type Who = { auth: Record<string, string> };
  const csv = (lines: string[]) => Buffer.from(`﻿${lines.join("\r\n")}\r\n`, "utf8");
  const send = (who: Who, path: "preview" | "", file: Buffer, name: string, options: Record<string, unknown>) =>
    http()
      .post(`/v1/imports${path ? `/${path}` : ""}`)
      .set(who.auth)
      .attach("file", file, name)
      .field("options", JSON.stringify(options));
  const contacts = async (who: Who, query: Record<string, string> = {}) =>
    (await http().get("/v1/contacts").query({ limit: "100", ...query }).set(who.auth).expect(200)).body.items as ContactDto[];
  /** Binary download as a Buffer */
  const download = (who: Who, path: string, query: Record<string, string>) =>
    http()
      .get(path)
      .query(query)
      .set(who.auth)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });

  it("only owners and admins import and export; others get 403", async () => {
    const owner = await signup(app);
    const manager = await addMember(app, owner, "MANAGER");
    const emp = await addMember(app, owner, "EMPLOYEE");
    const file = csv(["Ad", "Aysel"]);
    for (const who of [manager, emp]) {
      await send(who, "preview", file, "a.csv", { entity: "person" }).expect(403);
      await http().get("/v1/imports").set(who.auth).expect(403);
      await http().get("/v1/exports/contacts").set(who.auth).expect(403);
      await http().get("/v1/exports/deals").set(who.auth).expect(403);
    }
    await send(owner, "preview", file, "a.csv", { entity: "person" }).expect(200);
  });

  it("people: suggested columns, validation, duplicates, company links, custom fields; then history", async () => {
    const owner = await signup(app);
    const manager = await addMember(app, owner, "MANAGER");
    const branch = (await http().post("/v1/fields").set(owner.auth).send({ entity: "contact", label: "Filial", type: "select", options: ["Bakı", "Gəncə"], required: true }).expect(201))
      .body as FieldDefinitionDto;
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Köhnə Kamran", email: "kamran@x.az", customFields: { [branch.id]: "Bakı" } }).expect(201);
    await http().post("/v1/contacts").set(owner.auth).send({ type: "company", name: "Araz MMC" }).expect(201);

    const file = csv([
      "Ad soyad;E-poçt;Telefon;Şirkət;Status;Etiketlər;Məsul;Filial;Qeyri-müəyyən",
      "Aysel Məmmədova;AYSEL@x.az;+994 50 123 45 67;araz mmc;Müştəri;vip, topdan;;gəncə;x",
      `Kamran Əliyev;kamran@x.az;;;;;;Bakı;`,
      "Nigar;nigar@x;;;;;;Bakı;",
      "Tural;tural@x.az;;Yeni Şirkət;Lead;;;Bakı;",
      "Tural 2;tural@x.az;;;;;;Bakı;",
      "Leyla;;;Yeni şirkət;;;yoxdur@x.az;Sumqayıt;",
      ";;;;;;;Bakı;",
      `Səbinə;sebine@x.az;;;Customer;;${manager.email};Gəncə;`,
    ]);

    const preview = (await send(owner, "preview", file, "musteriler.csv", { entity: "person" }).expect(200)).body as ImportPreviewDto;
    expect(preview.headers[0]).toBe("Ad soyad");
    expect(preview.mapping).toEqual(["name", "email", "phone", "company", "stage", "tags", "owner", `cf.${branch.id}`, ""]);
    expect(preview.rows).toBe(8);
    expect(preview.missing).toEqual([]);
    expect(preview.summary).toEqual({ create: 3, update: 0, skip: 2, failed: 3, companies: 1 });
    const byRow = (row: number) => preview.issues.filter((i) => i.row === row).map((i) => `${i.field ?? ""}:${i.code}`);
    expect(byRow(3)).toEqual([":duplicate"]);
    expect(byRow(4)).toEqual(["email:invalid_email"]);
    expect(byRow(5)).toEqual([]);
    expect(byRow(6)).toEqual([":duplicate_in_file"]);
    expect(preview.issues.find((i) => i.row === 6)?.value).toBe("5");
    expect(byRow(7)).toEqual(["owner:unknown_owner", `cf.${branch.id}:unknown_option`]);
    expect(byRow(8)).toEqual(["name:required"]);
    // A preview writes nothing
    expect((await contacts(owner)).map((c) => c.name).sort()).toEqual(["Araz MMC", "Köhnə Kamran"]);

    const job = (await send(owner, "", file, "musteriler.csv", { entity: "person" }).expect(201)).body as ImportJobDetailDto;
    expect(job.summary).toEqual(preview.summary);
    expect(job.issueRows.map((r) => r.row)).toEqual([3, 4, 6, 7, 8]);
    expect(job.issueRows[1]!.cells.slice(0, 2)).toEqual(["Nigar", "nigar@x"]);

    const all = await contacts(owner);
    const aysel = all.find((c) => c.name === "Aysel Məmmədova")!;
    const araz = all.find((c) => c.name === "Araz MMC")!;
    expect(aysel).toMatchObject({ email: "aysel@x.az", phone: "+994501234567", stage: "CUSTOMER", tags: ["vip", "topdan"], companyId: araz.id, companyName: "Araz MMC" });
    expect(aysel.customFields).toEqual({ [branch.id]: "Gəncə" });
    // Created once for Tural; Leyla's row (same company, other case) failed
    const created = all.find((c) => c.name === "Yeni Şirkət")!;
    expect(created.type).toBe("company");
    expect(all.find((c) => c.name === "Tural")!.companyId).toBe(created.id);
    expect(all.find((c) => c.name === "Səbinə")!.owner?.name).toBe("Test MANAGER");

    const history = (await http().get("/v1/imports").set(owner.auth).expect(200)).body as ImportJobDto[];
    expect(history.map((h) => [h.fileName, h.entity, h.rows])).toEqual([["musteriler.csv", "person", 8]]);
    expect(history[0]!.by?.name).toBe("Test Sahib");
    const detail = (await http().get(`/v1/imports/${job.id}`).set(owner.auth).expect(200)).body as ImportJobDetailDto;
    expect(detail.issues).toHaveLength(job.issues.length);

    // Other companies can't read the job
    const other = await signup(app);
    await http().get(`/v1/imports/${job.id}`).set(other.auth).expect(404);
  });

  it("update mode fills only the file's cells and merges tags; managers can't update others' records", async () => {
    const owner = await signup(app);
    const manager = await addMember(app, owner, "MANAGER");
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Aysel", email: "aysel@x.az", phone: "+994501111111", tags: ["köhnə"], source: "website" }).expect(201);

    const file = csv(["email,tags,phone,source", "aysel@x.az,yeni,,referral", "yeni@x.az,a,,"]);
    const res = (await send(owner, "", file, "a.csv", { entity: "person", duplicates: "update", mapping: ["email", "tags", "phone", "source"] }).expect(400)).body;
    expect(res.error.details).toEqual({ mapping: ["name"] });

    const file2 = csv(["Ad,email,tags,phone,source", ",aysel@x.az,yeni,,Tövsiyə", "Yeni,yeni@x.az,a,,"]);
    const job = (await send(owner, "", file2, "a.csv", { entity: "person", duplicates: "update" }).expect(201)).body as ImportJobDetailDto;
    expect(job.summary).toMatchObject({ create: 1, update: 1, failed: 0 });
    const aysel = (await contacts(owner, { q: "Aysel" }))[0]!;
    expect(aysel).toMatchObject({ name: "Aysel", phone: "+994501111111", source: "referral", tags: ["köhnə", "yeni"] });

    // A manager allowed to import still can't change records outside their scope
    await withRawDb((db) => db.membership.update({ id: manager.memberId }, { $set: { permissions: ["data.import"] } }));
    const denied = (await send(manager, "", csv(["Ad,email", "Aysel B,aysel@x.az"]), "a.csv", { entity: "person", duplicates: "update" }).expect(201)).body as ImportJobDetailDto;
    expect(denied.summary).toMatchObject({ update: 0, failed: 1 });
    expect(denied.issues[0]).toMatchObject({ row: 2, code: "not_visible" });
  });

  it("companies from Excel: duplicates by name; an unreadable file is a clear error", async () => {
    const owner = await signup(app);
    await http().post("/v1/contacts").set(owner.auth).send({ type: "company", name: "Araz MMC" }).expect(201);
    const xlsx = toXlsx([
      ["Şirkət", "Email", "Telefon"],
      ["ARAZ mmc", "info@araz.az", ""],
      ["Bravo", "", 994124000000],
    ]);
    const job = (await send(owner, "", xlsx, "sirketler.xlsx", { entity: "company" }).expect(201)).body as ImportJobDetailDto;
    expect(job.mapping).toEqual(["name", "email", "phone"]);
    expect(job.summary).toMatchObject({ create: 1, skip: 1 });
    const bravo = (await contacts(owner, { q: "Bravo" }))[0]!;
    expect(bravo).toMatchObject({ type: "company", phone: "994124000000" });

    const bad = await send(owner, "preview", Buffer.from("PK\u0003\u0004 not really a zip"), "x.xlsx", { entity: "company" }).expect(400);
    expect(bad.body.error.details).toEqual({ file: ["format"] });
    const empty = await send(owner, "preview", csv(["Ad"]), "x.csv", { entity: "company" }).expect(400);
    expect(empty.body.error.details).toEqual({ file: ["empty"] });
  });

  it("deals: pipeline and stage by name, closed history, currencies and customers", async () => {
    const owner = await signup(app);
    await http().patch("/v1/settings/currencies").set(owner.auth).send({ rates: { USD: 1.7 } }).expect(200);
    const second = (await http().post("/v1/pipelines").set(owner.auth).send({ name: "Topdan" }).expect(201)).body as PipelineDto;
    const aysel = (await http().post("/v1/contacts").set(owner.auth).send({ name: "Aysel", email: "aysel@x.az" }).expect(201)).body as ContactDto;
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Kamran" }).expect(201);
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Kamran" }).expect(201);

    const file = csv([
      "Satışın adı,Məbləğ,Valyuta,Satış prosesi,Mərhələ,Müştəri,Bağlanma tarixi",
      'Ofis,"1 500,50",,,,aysel@x.az,',
      "İxrac,1000,$,topdan,qazanıldı,,31.03.2026",
      "Avro,100,EUR,,,,",
      "Kamran işi,10,,,,Kamran,",
      "Naməlum,10,,,Yoxdur,Heç kim,",
    ]);
    const job = (await send(owner, "", file, "deals.csv", { entity: "deal" }).expect(201)).body as ImportJobDetailDto;
    expect(job.summary).toMatchObject({ create: 2, failed: 3 });
    expect(job.issues.map((i) => `${i.row}:${i.field}:${i.code}`)).toEqual(["4:currency:no_rate", "5:contact:ambiguous_contact", "6:stage:unknown_stage", "6:contact:unknown_contact"]);

    const main = (await http().get("/v1/deals").set(owner.auth).expect(200)).body as DealDto[];
    expect(main.map((d) => [d.title, d.amount, d.currency, d.contact?.id])).toEqual([["Ofis", 150050, "AZN", aysel.id]]);
    // Closed long ago, so not on the board: read it directly
    const [won] = await withRawDb((db) => db.deal.find({ pipelineId: second.id }));
    expect(won).toMatchObject({ title: "İxrac", amount: 100000, currency: "USD", baseAmount: 170000 });
    expect(won!.closedAt?.toISOString()).toBe("2026-03-31T00:00:00.000Z");
  });

  it("exports follow the list's filters and import back unchanged; templates carry custom fields", async () => {
    const owner = await signup(app);
    const tin = (await http().post("/v1/fields").set(owner.auth).send({ entity: "company", label: "VÖEN", type: "text" }).expect(201)).body as FieldDefinitionDto;
    await http().post("/v1/contacts").set(owner.auth).send({ type: "company", name: "Araz MMC", customFields: { [tin.id]: "1400123456" } }).expect(201);
    await http().post("/v1/contacts").set(owner.auth).send({ name: "Aysel", email: "aysel@x.az", tags: ["vip"], stage: "CUSTOMER" }).expect(201);
    await http().post("/v1/contacts").set(owner.auth).send({ name: "=cmd|' /C calc'!A0" }).expect(201);

    const companies = await download(owner, "/v1/exports/contacts", { type: "company", format: "xlsx", lang: "az" }).expect(200);
    expect(companies.headers["content-disposition"]).toMatch(/attachment; filename="customers-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const sheet = readXlsx(companies.body as Buffer);
    expect(sheet[0]).toEqual(["Növ", "Ad", "Email", "Telefon", "Şirkət", "Status", "Mənbə", "Etiketlər", "Məsul", "Əlavə olunub", "VÖEN"]);
    expect(sheet.slice(1).map((r) => [r[0], r[1], r[10]])).toEqual([["Şirkət", "Araz MMC", "1400123456"]]);

    const people = await download(owner, "/v1/exports/contacts", { type: "person", format: "csv", lang: "en" }).expect(200);
    const text = (people.body as Buffer).toString("utf8");
    expect(text.startsWith("﻿\"Type\",\"Name\"")).toBe(true);
    expect(text).toContain("\"'=cmd|' /C calc'!A0\"");
    expect(text).toContain('"Customer"');

    // The exported file goes back in: everyone is already there
    const again = (await send(owner, "", people.body as Buffer, "people.csv", { entity: "person" }).expect(201)).body as ImportJobDetailDto;
    expect(again.summary).toMatchObject({ create: 1, skip: 1, failed: 0 });

    const template = await download(owner, "/v1/imports/template", { entity: "company", lang: "ru" }).expect(200);
    expect(readXlsx(template.body as Buffer)[0]).toEqual(["Имя", "Email", "Телефон", "Статус", "Источник", "Метки", "Ответственный", "VÖEN"]);

    const deals = await download(owner, "/v1/exports/deals", { format: "xlsx" }).expect(200);
    expect(readXlsx(deals.body as Buffer)[0]!.slice(0, 4)).toEqual(["Satışın adı", "Məbləğ", "Valyuta", "Əsas valyutada məbləğ (AZN)"]);
  });
});
