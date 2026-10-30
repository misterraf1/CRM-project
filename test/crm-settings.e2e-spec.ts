import type { ContactDetailDto, ContactDto, CurrencySettingsDto, DealDto, FieldDefinitionDto, ForecastDto, PipelineDto } from "@/shared";
import request from "supertest";
import { addMember, createApp, signup, type Company, type TestApp } from "./helpers";

describe("CRM settings: custom fields, companies, pipelines, currencies", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  type Who = { auth: Record<string, string> };
  const field = (who: Who, body: Record<string, unknown>) => http().post("/v1/fields").set(who.auth).send(body);
  const contact = (who: Who, body: Record<string, unknown>) => http().post("/v1/contacts").set(who.auth).send(body);
  const pipelines = async (who: Who) => (await http().get("/v1/pipelines").set(who.auth).expect(200)).body as PipelineDto[];
  const deal = (who: Who, body: Record<string, unknown>) => http().post("/v1/deals").set(who.auth).send(body);

  describe("custom fields", () => {
    it("definitions: only configurers create them; values are validated, required and filterable", async () => {
      const owner = await signup(app);
      const emp = await addMember(app, owner, "EMPLOYEE");
      await field(emp, { entity: "contact", label: "Filial", type: "text" }).expect(403);

      const branch = (await field(owner, { entity: "contact", label: "Filial", type: "select", options: ["Bakı", "Gəncə"], required: true }).expect(201)).body as FieldDefinitionDto;
      const tin = (await field(owner, { entity: "company", label: "VÖEN", type: "text" }).expect(201)).body as FieldDefinitionDto;
      const vip = (await field(owner, { entity: "contact", label: "VIP", type: "checkbox" }).expect(201)).body as FieldDefinitionDto;
      await field(owner, { entity: "contact", label: "Boş seçim", type: "select", options: [] }).expect(400);

      // Everyone reads the definitions (forms render them)
      const forPeople = (await http().get("/v1/fields").query({ entity: "contact" }).set(emp.auth).expect(200)).body as FieldDefinitionDto[];
      expect(forPeople.map((f) => f.label)).toEqual(["Filial", "VIP"]);

      const missing = await contact(owner, { name: "Aysel" }).expect(400);
      expect(Object.keys(missing.body.error.details)).toEqual([`cf.${branch.id}`]);
      await contact(owner, { name: "Aysel", customFields: { [branch.id]: "Sumqayıt" } }).expect(400);
      await contact(owner, { name: "Aysel", customFields: { [branch.id]: "Bakı", [tin.id]: "123" } }).expect(400); // company field on a person
      await contact(owner, { name: "Aysel", customFields: { [branch.id]: "Bakı", unknown: "x" } }).expect(400);

      const aysel = (await contact(owner, { name: "Aysel", customFields: { [branch.id]: "Bakı", [vip.id]: true } }).expect(201)).body as ContactDto;
      expect(aysel.customFields).toEqual({ [branch.id]: "Bakı", [vip.id]: true });
      await contact(owner, { name: "Kamran", customFields: { [branch.id]: "Gəncə" } }).expect(201);
      const company = (await contact(owner, { type: "company", name: "Araz MMC", customFields: { [tin.id]: "1400123456" } }).expect(201)).body as ContactDto;
      expect(company.customFields).toEqual({ [tin.id]: "1400123456" });

      const names = async (query: Record<string, string>) =>
        ((await http().get("/v1/contacts").query(query).set(owner.auth).expect(200)).body.items as ContactDto[]).map((c) => c.name).sort();
      expect(await names({ field: branch.id, value: "Gəncə" })).toEqual(["Kamran"]);
      expect(await names({ field: vip.id, value: "true" })).toEqual(["Aysel"]);
      expect(await names({ field: vip.id, value: "false" })).toEqual(["Araz MMC", "Kamran"]);
      expect(await names({ field: tin.id, value: "1400" })).toEqual(["Araz MMC"]);

      // Updates: a required value can't be cleared; untouched fields stay
      await http().patch(`/v1/contacts/${aysel.id}`).set(owner.auth).send({ customFields: { [branch.id]: null } }).expect(400);
      const unvip = await http().patch(`/v1/contacts/${aysel.id}`).set(owner.auth).send({ customFields: { [vip.id]: false } }).expect(200);
      expect(unvip.body.customFields).toEqual({ [branch.id]: "Bakı" });

      // An option in use can't be removed; archived fields can't be written
      const inUse = await http().patch(`/v1/fields/${branch.id}`).set(owner.auth).send({ options: ["Gəncə"] }).expect(409);
      expect(inUse.body.error.details.options).toEqual(["Bakı"]);
      await http().patch(`/v1/fields/${branch.id}`).set(owner.auth).send({ options: ["Bakı", "Gəncə", "Şəki"] }).expect(200);
      await http().patch(`/v1/fields/${vip.id}`).set(owner.auth).send({ archived: true }).expect(200);
      await http().patch(`/v1/contacts/${aysel.id}`).set(owner.auth).send({ customFields: { [vip.id]: true } }).expect(400);
      expect(((await http().get("/v1/fields").query({ entity: "contact" }).set(owner.auth).expect(200)).body as FieldDefinitionDto[]).map((f) => f.label)).toEqual(["Filial"]);

      // Reorder needs the full list
      const all = (await http().get("/v1/fields").query({ entity: "contact", archived: "true" }).set(owner.auth).expect(200)).body as FieldDefinitionDto[];
      await http().post("/v1/fields/reorder").set(owner.auth).send({ entity: "contact", ids: [vip.id] }).expect(400);
      const reordered = (await http().post("/v1/fields/reorder").set(owner.auth).send({ entity: "contact", ids: all.map((f) => f.id).reverse() }).expect(200)).body as FieldDefinitionDto[];
      expect(reordered.map((f) => f.label)).toEqual(["VIP", "Filial"]);

      // Another company never sees or uses these definitions
      const other = await signup(app);
      expect((await http().get("/v1/fields").set(other.auth).expect(200)).body).toEqual([]);
      await contact(other, { name: "X", customFields: { [tin.id]: "1" } }).expect(400);
    });

    it("deal fields: money and dates", async () => {
      const owner = await signup(app);
      const budget = (await field(owner, { entity: "deal", label: "Büdcə", type: "currency" }).expect(201)).body as FieldDefinitionDto;
      const start = (await field(owner, { entity: "deal", label: "Başlama", type: "date" }).expect(201)).body as FieldDefinitionDto;
      await deal(owner, { title: "Pis tarix", customFields: { [start.id]: "31/12/2026" } }).expect(400);
      const d = (await deal(owner, { title: "Layihə", amount: 50000, customFields: { [budget.id]: 120000.4, [start.id]: "2026-12-01" } }).expect(201)).body as DealDto;
      expect(d.customFields).toEqual({ [budget.id]: 120000, [start.id]: "2026-12-01" });
    });
  });

  describe("companies and people", () => {
    it("link people to a company; the company shows them and their deals", async () => {
      const owner = await signup(app);
      const araz = (await contact(owner, { type: "company", name: "Araz MMC" }).expect(201)).body as ContactDto;
      const aysel = (await contact(owner, { name: "Aysel", companyId: araz.id }).expect(201)).body as ContactDto;
      expect(aysel).toMatchObject({ companyId: araz.id, companyName: "Araz MMC" });
      const lone = (await contact(owner, { name: "Tək", companyName: "Köhnə mətn" }).expect(201)).body as ContactDto;
      expect(lone).toMatchObject({ companyId: null, companyName: "Köhnə mətn" });
      await contact(owner, { name: "Səhv", companyId: aysel.id }).expect(400); // a person is not a company

      await deal(owner, { title: "Aysel ilə", amount: 1000, contactId: aysel.id }).expect(201);
      const detail = (await http().get(`/v1/contacts/${araz.id}`).set(owner.auth).expect(200)).body as ContactDetailDto;
      expect(detail.people.map((p) => p.name)).toEqual(["Aysel"]);
      expect(detail.deals.map((d) => d.title)).toEqual(["Aysel ilə"]);

      const byCompany = await http().get("/v1/contacts").query({ companyId: araz.id }).set(owner.auth).expect(200);
      expect(byCompany.body.items.map((c: ContactDto) => c.name)).toEqual(["Aysel"]);
      const companies = await http().get("/v1/contacts").query({ type: "company" }).set(owner.auth).expect(200);
      expect(companies.body.items.map((c: ContactDto) => c.name)).toEqual(["Araz MMC"]);

      // A rename reaches the people; a company with people can't turn into a person
      await http().patch(`/v1/contacts/${araz.id}`).set(owner.auth).send({ name: "Araz Group" }).expect(200);
      expect((await http().get(`/v1/contacts/${aysel.id}`).set(owner.auth).expect(200)).body.companyName).toBe("Araz Group");
      await http().patch(`/v1/contacts/${araz.id}`).set(owner.auth).send({ type: "person" }).expect(409);

      // Unlink by typing a plain name
      const unlinked = await http().patch(`/v1/contacts/${aysel.id}`).set(owner.auth).send({ companyId: null, companyName: "Başqa" }).expect(200);
      expect(unlinked.body).toMatchObject({ companyId: null, companyName: "Başqa" });

      const other = await signup(app);
      await contact(other, { name: "Yad", companyId: araz.id }).expect(400);
    });
  });

  describe("pipelines and stages", () => {
    it("create, edit stages, protect deals, delete and default", async () => {
      const owner = await signup(app);
      const emp = await addMember(app, owner, "EMPLOYEE");
      await http().post("/v1/pipelines").set(emp.auth).send({ name: "Topdan" }).expect(403);

      const wholesale = (await http().post("/v1/pipelines").set(owner.auth).send({ name: "Topdan" }).expect(201)).body as PipelineDto;
      expect(wholesale.isDefault).toBe(false);
      expect(wholesale.stages.map((s) => s.kind)).toEqual(["open", "open", "open", "open", "won", "lost"]);

      const [first, second, , , won, lost] = wholesale.stages;
      const stages = [
        { id: first!.id, name: "Sorğu", probability: 20, kind: "open" },
        { name: "Nümunə göndərildi", probability: 60, kind: "open" },
        { id: won!.id, name: "Satıldı", probability: 100, kind: "won" },
        { id: lost!.id, name: "İtirildi", probability: 0, kind: "lost" },
      ];
      const edited = (await http().patch(`/v1/pipelines/${wholesale.id}/stages`).set(owner.auth).send({ stages }).expect(200)).body as PipelineDto;
      expect(edited.stages.map((s) => [s.name, s.order])).toEqual([
        ["Sorğu", 0],
        ["Nümunə göndərildi", 1],
        ["Satıldı", 2],
        ["İtirildi", 3],
      ]);
      expect(edited.stages.some((s) => s.id === second!.id)).toBe(false);
      await http().patch(`/v1/pipelines/${wholesale.id}/stages`).set(owner.auth).send({ stages: stages.filter((s) => s.kind !== "won") }).expect(400);

      // A stage with deals can't be removed, nor change its kind
      const d = (await deal(owner, { title: "Topdan sifariş", pipelineId: wholesale.id, stageId: first!.id }).expect(201)).body as DealDto;
      const withoutFirst = edited.stages.filter((s) => s.id !== first!.id).map(({ id, name, probability, kind }) => ({ id, name, probability, kind }));
      const blocked = await http().patch(`/v1/pipelines/${wholesale.id}/stages`).set(owner.auth).send({ stages: withoutFirst }).expect(409);
      expect(blocked.body.error.details.stages).toEqual(["Sorğu"]);
      const kinds = edited.stages.map(({ id, name, probability, kind }) => ({ id, name, probability, kind: id === first!.id ? "won" : kind === "won" ? "open" : kind }));
      await http().patch(`/v1/pipelines/${wholesale.id}/stages`).set(owner.auth).send({ stages: kinds }).expect(409);

      // Board per pipeline
      const board = (await http().get("/v1/deals").query({ pipelineId: wholesale.id }).set(owner.auth).expect(200)).body as DealDto[];
      expect(board.map((x) => x.id)).toEqual([d.id]);

      await http().delete(`/v1/pipelines/${wholesale.id}`).set(owner.auth).expect(409);
      await http().delete(`/v1/deals/${d.id}`).set(owner.auth).expect(204);

      // Default moves; the default one can't be deleted
      await http().patch(`/v1/pipelines/${wholesale.id}`).set(owner.auth).send({ isDefault: true, name: "Topdan satış" }).expect(200);
      const all = await pipelines(owner);
      expect(all.map((p) => [p.name, p.isDefault])).toEqual([
        ["Topdan satış", true],
        ["Satış", false],
      ]);
      await http().delete(`/v1/pipelines/${wholesale.id}`).set(owner.auth).expect(409);
      await http().delete(`/v1/pipelines/${all[1]!.id}`).set(owner.auth).expect(204);
      expect((await pipelines(owner)).map((p) => p.name)).toEqual(["Topdan satış"]);

      const other = await signup(app);
      await http().patch(`/v1/pipelines/${wholesale.id}`).set(other.auth).send({ name: "Oğurluq" }).expect(404);
    });
  });

  describe("currencies", () => {
    const forecast = async (who: Company) => (await http().get("/v1/deals/forecast").set(who.auth).expect(200)).body as ForecastDto;

    it("deals in other currencies count in the company currency; closed deals keep their rate", async () => {
      const owner = await signup(app);
      const emp = await addMember(app, owner, "EMPLOYEE");
      const local = (await deal(owner, { title: "Yerli", amount: 10000 }).expect(201)).body as DealDto;
      expect(local).toMatchObject({ currency: "AZN", baseAmount: 10000 });

      await deal(owner, { title: "Dollarla", amount: 100000, currency: "USD" }).expect(400);
      await http().patch("/v1/settings/currencies").set(emp.auth).send({ rates: { USD: 1.7 } }).expect(403);
      const settings = (await http().patch("/v1/settings/currencies").set(owner.auth).send({ rates: { USD: 1.7, AZN: 5 } }).expect(200)).body as CurrencySettingsDto;
      expect(settings).toEqual({ base: "AZN", rates: { USD: 1.7 }, available: ["AZN", "USD"] });

      const usd = (await deal(owner, { title: "Dollarla", amount: 100000, currency: "USD" }).expect(201)).body as DealDto;
      const usd2 = (await deal(owner, { title: "Dollarla 2", amount: 20000, currency: "USD" }).expect(201)).body as DealDto;
      expect(usd).toMatchObject({ amount: 100000, currency: "USD", baseAmount: 170000 });
      expect((await forecast(owner)).open.amount).toBe(10000 + 170000 + 34000);

      // Win one at 1.7, then the rate moves: only the open deal is re-priced
      const p = (await pipelines(owner))[0]!;
      await http().post(`/v1/deals/${usd.id}/move`).set(owner.auth).send({ stageId: p.stages.find((s) => s.kind === "won")!.id }).expect(200);
      await http().patch("/v1/settings/currencies").set(owner.auth).send({ rates: { USD: 1.8 } }).expect(200);
      expect((await http().get(`/v1/deals/${usd.id}`).set(owner.auth).expect(200)).body.baseAmount).toBe(170000);
      expect((await http().get(`/v1/deals/${usd2.id}`).set(owner.auth).expect(200)).body.baseAmount).toBe(36000);
      const f = await forecast(owner);
      expect(f.wonThisMonth.amount).toBe(170000);
      expect(f.open.amount).toBe(10000 + 36000);

      // Changing a deal's currency re-prices it; a rate in use can't be removed
      const switched = await http().patch(`/v1/deals/${local.id}`).set(owner.auth).send({ currency: "USD" }).expect(200);
      expect(switched.body).toMatchObject({ amount: 10000, currency: "USD", baseAmount: 18000 });
      await http().patch("/v1/settings/currencies").set(owner.auth).send({ rates: {} }).expect(409);
    });
  });
});
