import { randomBytes } from "node:crypto";
import { Binary, type ClientSession, type Collection, type Document } from "mongodb";
import { AppError } from "../common/errors";
import { DEFAULTS, HAS_UPDATED_AT, TENANT_MODELS, type ModelName, type Models } from "./models";

/**
 * Tenant isolation for MongoDB (which has no row-level security), enforced on every
 * collection operation that goes through a Repo:
 *  - reads are narrowed to the current tenant (Membership/Tenant also to the caller's
 *    own memberships — needed for login and the workspace switcher),
 *  - updates/deletes are narrowed to the current tenant, `tenantId` can't be changed,
 *  - inserts for another tenant are rejected,
 *  - without a tenant context nothing matches and writes are rejected (fail closed).
 * Platform code that must work across tenants (webhooks, jobs) uses `db.system`.
 */
export interface DbScope {
  tenantId?: string;
  userId?: string;
  /** Explicit bypass for cross-tenant platform operations */
  system?: boolean;
}

export class TenantGuardError extends Error {}

export type Filter = Record<string, unknown>;
export type Update = Record<string, unknown>;
export type Sort = Record<string, 1 | -1>;

export interface FindOptions {
  sort?: Sort;
  limit?: number;
  skip?: number;
  /** Fields to return, e.g. `{ id: 1, name: 1 }` */
  projection?: Record<string, 0 | 1>;
}

/** New document: `id` and fields with defaults may be left out. */
export type Insert<T> = { id?: string } & Partial<T>;

/** Matches no document: a tenant query without tenant context. */
const NOTHING = { _id: "__no_tenant_context__" };

/** Sortable, cuid-like id for new documents. */
export const createId = () => `c${Date.now().toString(36)}${randomBytes(9).toString("base64url")}`;

const LOGICAL = new Set(["$and", "$or", "$nor"]);

/** The app speaks `id`; MongoDB stores `_id`. */
function toMongo(filter: Filter): Filter {
  const out: Filter = {};
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined) continue;
    if (LOGICAL.has(k) && Array.isArray(v)) out[k] = v.map((f) => toMongo(f as Filter));
    else out[k === "id" ? "_id" : k] = v;
  }
  return out;
}

const renameId = <V>(obj: Record<string, V> | undefined) =>
  obj && Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === "id" ? "_id" : k, v]));

export function fromMongo<T>(doc: Document | null): T | null {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  for (const [k, v] of Object.entries(rest)) if (v instanceof Binary) rest[k] = Buffer.from(v.buffer);
  return { id: _id, ...rest } as T;
}

/** One collection, bound to a scope and (inside a transaction) a session. */
export class Repo<M extends ModelName, T = Models[M]> {
  constructor(
    private readonly model: M,
    private readonly coll: Collection<Document>,
    private readonly scope: DbScope,
    private readonly session: ClientSession | undefined,
    /** Serialises operations of one transaction (a session runs one at a time) */
    private readonly run: <R>(op: () => Promise<R>) => Promise<R>,
    private readonly membershipTenants: () => Promise<string[]>,
    /** Called before every write; a read-only attempt throws here so nothing is written */
    private readonly beforeWrite: () => void = () => {},
  ) {}

  private get tenantModel() {
    return TENANT_MODELS.has(this.model);
  }

  private async readScope(): Promise<Filter | null> {
    const s = this.scope;
    if (s.system) return null;
    if (this.model === "PlatformExpense") throw new TenantGuardError("PlatformExpense is platform-only");
    if (this.model === "Tenant") {
      const ids = [...(s.tenantId ? [s.tenantId] : []), ...(s.userId ? await this.membershipTenants() : [])];
      return ids.length ? { _id: { $in: ids } } : NOTHING;
    }
    if (this.model === "Membership") {
      const or = [...(s.tenantId ? [{ tenantId: s.tenantId }] : []), ...(s.userId ? [{ userId: s.userId }] : [])];
      return or.length ? { $or: or } : NOTHING;
    }
    if (!this.tenantModel) return null;
    return s.tenantId ? { tenantId: s.tenantId } : NOTHING;
  }

  private writeScope(): Filter | null {
    const s = this.scope;
    if (s.system) return null;
    if (this.model === "PlatformExpense") throw new TenantGuardError("PlatformExpense is platform-only");
    if (this.model === "Plan") throw new TenantGuardError("Plans are read-only for tenants");
    if (this.model === "Tenant") return s.tenantId ? { _id: s.tenantId } : NOTHING;
    if (!this.tenantModel) return null;
    return s.tenantId ? { tenantId: s.tenantId } : NOTHING;
  }

  private narrow(filter: Filter, scope: Filter | null): Filter {
    const f = toMongo(filter);
    if (!scope) return f;
    // Top-level unless a key collides with a different value (upserts take equality fields from there)
    const clash = Object.entries(scope).some(([k, v]) => k in f && JSON.stringify(f[k]) !== JSON.stringify(v));
    return clash ? { $and: [f, scope] } : { ...f, ...scope };
  }

  private checkInsert(doc: Document) {
    const s = this.scope;
    if (s.system) return;
    this.writeScope();
    const value = this.model === "Tenant" ? doc._id : doc.tenantId;
    if ((this.tenantModel || this.model === "Tenant") && (!s.tenantId || value !== s.tenantId)) {
      throw new TenantGuardError(`${this.model}: write outside the current tenant`);
    }
  }

  private prepareUpdate(update: Update): Update {
    const set = { ...((update.$set as Document | undefined) ?? {}) };
    if (!this.scope.system && "tenantId" in set && set.tenantId !== this.scope.tenantId) {
      throw new TenantGuardError(`${this.model}: tenant cannot be changed`);
    }
    if ("id" in set) throw new TenantGuardError(`${this.model}: id cannot be changed`);
    if (HAS_UPDATED_AT.has(this.model) && !("updatedAt" in set)) set.updatedAt = new Date();
    for (const [k, v] of Object.entries(set)) if (v === undefined) delete set[k];
    const out = { ...update };
    if (Object.keys(set).length) out.$set = set;
    else delete out.$set;
    return out;
  }

  /** Schema defaults for omitted fields (explicit nulls keep `{ field: null }` filters exact). */
  private withDefaults(doc: Insert<T>): Document {
    const now = new Date();
    const out: Document = {};
    for (const [k, v] of Object.entries(DEFAULTS[this.model])) out[k] = v === "now" ? now : Array.isArray(v) ? [...v] : v && typeof v === "object" ? { ...v } : v;
    for (const [k, v] of Object.entries(doc)) if (v !== undefined) out[k] = v;
    const { id, ...rest } = out;
    return { _id: (id as string | undefined) ?? createId(), ...rest };
  }

  private opts(o: FindOptions = {}) {
    return { session: this.session, sort: renameId(o.sort), limit: o.limit, skip: o.skip, projection: renameId(o.projection) };
  }

  async find(filter: Filter = {}, options?: FindOptions): Promise<T[]> {
    const scope = await this.readScope();
    return this.run(async () => (await this.coll.find(this.narrow(filter, scope), this.opts(options)).toArray()).map((d) => fromMongo<T>(d)!));
  }

  async findOne(filter: Filter, options?: Omit<FindOptions, "limit">): Promise<T | null> {
    const scope = await this.readScope();
    return this.run(async () => fromMongo<T>(await this.coll.findOne(this.narrow(filter, scope), this.opts(options))));
  }

  /** findOne, or 404 */
  async get(filter: Filter, options?: Omit<FindOptions, "limit">): Promise<T> {
    const doc = await this.findOne(filter, options);
    if (!doc) throw new AppError("NOT_FOUND", `${this.model} not found`);
    return doc;
  }

  async count(filter: Filter = {}): Promise<number> {
    const scope = await this.readScope();
    return this.run(() => this.coll.countDocuments(this.narrow(filter, scope), { session: this.session }));
  }

  /** Aggregation over the caller's documents only (the scope is the first stage). */
  async aggregate<R extends Document = Document>(pipeline: Document[]): Promise<R[]> {
    const scope = await this.readScope();
    const hasLookup = pipeline.some((stage) => "$lookup" in stage || "$unionWith" in stage || "$graphLookup" in stage);
    if (hasLookup && !this.scope.system) throw new TenantGuardError(`${this.model}: lookups would bypass tenant isolation`);
    // `$match` stages speak `id` like every other filter
    const translated = pipeline.map((stage) => ("$match" in stage ? { $match: toMongo(stage.$match as Filter) } : stage));
    const stages = scope ? [{ $match: scope }, ...translated] : translated;
    return this.run(() => this.coll.aggregate<R>(stages, { session: this.session }).toArray());
  }

  async distinct<V = unknown>(field: string, filter: Filter = {}): Promise<V[]> {
    const scope = await this.readScope();
    return this.run(() => this.coll.distinct(field === "id" ? "_id" : field, this.narrow(filter, scope), { session: this.session }) as Promise<V[]>);
  }

  async insertOne(doc: Insert<T>): Promise<T> {
    this.beforeWrite();
    const full = this.withDefaults(doc);
    this.checkInsert(full);
    await this.run(() => this.coll.insertOne(full, { session: this.session }));
    return fromMongo<T>(full)!;
  }

  async insertMany(docs: Insert<T>[]): Promise<T[]> {
    this.beforeWrite();
    if (!docs.length) return [];
    const full = docs.map((d) => this.withDefaults(d));
    full.forEach((d) => this.checkInsert(d));
    await this.run(() => this.coll.insertMany(full, { session: this.session }));
    return full.map((d) => fromMongo<T>(d)!);
  }

  /** Updates one document and returns it (after the update), or 404. */
  async update(filter: Filter, update: Update): Promise<T> {
    const doc = await this.findOneAndUpdate(filter, update);
    if (!doc) throw new AppError("NOT_FOUND", `${this.model} not found`);
    return doc;
  }

  async findOneAndUpdate(filter: Filter, update: Update, options: { sort?: Sort } = {}): Promise<T | null> {
    this.beforeWrite();
    const scope = this.writeScope();
    const u = this.prepareUpdate(update);
    return this.run(async () =>
      fromMongo<T>(await this.coll.findOneAndUpdate(this.narrow(filter, scope), u, { session: this.session, returnDocument: "after", sort: renameId(options.sort) })),
    );
  }

  /** Returns how many documents matched. */
  async updateMany(filter: Filter, update: Update): Promise<{ count: number }> {
    this.beforeWrite();
    const scope = this.writeScope();
    const u = this.prepareUpdate(update);
    const res = await this.run(() => this.coll.updateMany(this.narrow(filter, scope), u, { session: this.session }));
    return { count: res.matchedCount };
  }

  /**
   * Atomic update-or-insert: applies `update` to the match, or creates it from `insert`
   * (plus defaults). Fields the update itself sets are taken from the update.
   */
  async upsert(filter: Filter, update: Update, insert: Insert<T>): Promise<T> {
    this.beforeWrite();
    const scope = this.writeScope();
    const u = this.prepareUpdate(update);
    const full = this.withDefaults(insert);
    this.checkInsert(full);
    const touched = new Set(Object.values(u).flatMap((ops) => Object.keys(ops as Document)));
    const mongoFilter = toMongo(filter);
    const onInsert = Object.fromEntries(Object.entries(full).filter(([k]) => !touched.has(k) && !(k in mongoFilter)));
    return this.run(async () =>
      fromMongo<T>(
        await this.coll.findOneAndUpdate(this.narrow(filter, scope), { ...u, $setOnInsert: onInsert }, { session: this.session, upsert: true, returnDocument: "after" }),
      )!,
    );
  }

  /** Deletes one document and returns it, or 404. */
  async delete(filter: Filter): Promise<T> {
    this.beforeWrite();
    const scope = this.writeScope();
    const doc = await this.run(async () => fromMongo<T>(await this.coll.findOneAndDelete(this.narrow(filter, scope), { session: this.session })));
    if (!doc) throw new AppError("NOT_FOUND", `${this.model} not found`);
    return doc;
  }

  async deleteMany(filter: Filter): Promise<{ count: number }> {
    this.beforeWrite();
    const scope = this.writeScope();
    const res = await this.run(() => this.coll.deleteMany(this.narrow(filter, scope), { session: this.session }));
    return { count: res.deletedCount };
  }
}
