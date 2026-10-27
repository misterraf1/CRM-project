import { requestContext } from "@/server/common/context";
import { Database } from "@/server/db/database";
import { createId } from "@/server/db/repo";

// Read requests skip transactions (parallel queries); a write inside still commits atomically.

describe("Database.scoped in read requests", () => {
  let db: Database;
  const tenantId = createId();
  const asGet = <T>(fn: () => Promise<T>) => requestContext.run({ method: "GET", tenantId }, fn);

  beforeAll(() => {
    db = new Database(process.env.DATABASE_URL!);
  });
  afterAll(async () => {
    await db.system.department.deleteMany({ tenantId });
    await db.close();
  });

  it("returns reads without a transaction", async () => {
    await db.system.department.insertOne({ tenantId, name: "Satış" });
    const rows = await asGet(() => db.scoped((tx) => tx.department.find({ tenantId })));
    expect(rows.map((d) => d.name)).toEqual(["Satış"]);
  });

  it("reruns a writing callback in a transaction, writing once", async () => {
    let runs = 0;
    const result = await asGet(() =>
      db.scoped(async (tx) => {
        runs += 1;
        const before = await tx.department.count({ tenantId });
        await tx.department.insertOne({ tenantId, name: `Dept ${before}` });
        return before;
      }),
    );
    expect(runs).toBe(2);
    expect(result).toBe(1);
    expect(await db.system.department.count({ tenantId })).toBe(2);
  });

  it("still rolls back when the rerun fails after writing", async () => {
    await expect(
      asGet(() =>
        db.scoped(async (tx) => {
          await tx.department.insertOne({ tenantId, name: "Rolled back" });
          throw new Error("boom");
        }),
      ),
    ).rejects.toThrow("boom");
    expect(await db.system.department.count({ tenantId, name: "Rolled back" })).toBe(0);
  });

  it("a swallowed write signal still leads to the transaction", async () => {
    const result = await asGet(() =>
      db.scoped(async (tx) => {
        const created = await tx.department.insertOne({ tenantId, name: "Caught" }).catch(() => null);
        return created?.name ?? "skipped";
      }),
    );
    expect(result).toBe("Caught");
    expect(await db.system.department.count({ tenantId, name: "Caught" })).toBe(1);
  });
});
