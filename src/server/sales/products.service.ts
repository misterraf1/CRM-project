import type { ProductDto, ProductInput } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import type { Database, Tx } from "../db/database";
import type { Product } from "../db/models";

const MAX_PRODUCTS = 2000;

export const productDto = (p: Product, names: Map<string, string> = new Map()): ProductDto => ({
  id: p.id,
  name: p.name,
  sku: p.sku,
  description: p.description,
  unit: p.unit,
  price: p.price,
  currency: p.currency,
  taxBp: p.taxBp,
  active: p.active,
  components: (p.components ?? []).map((c) => ({ productId: c.productId, name: names.get(c.productId) ?? "", quantity: c.quantity })),
  renewalMonths: p.renewalMonths ?? null,
  priceTiers: p.priceTiers ?? [],
});

/** Names of the products bundles refer to. */
const componentNames = (rows: Product[]) => new Map(rows.map((p) => [p.id, p.name]));

/** The company's catalog: what quotes and invoices are made of. Everyone reads it; managing it is a permission. */
export class ProductsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false): Promise<ProductDto[]> {
    const { tenantId } = authedContext();
    const rows = await this.db.scoped((tx) => tx.product.find({ tenantId }, { sort: { name: 1 }, limit: MAX_PRODUCTS }));
    // Inactive products still name the bundles they are part of
    const names = componentNames(rows);
    return rows.filter((p) => includeInactive || p.active).map((p) => productDto(p, names));
  }

  async create(input: ProductInput): Promise<ProductDto> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      if ((await tx.product.count({ tenantId })) >= MAX_PRODUCTS) throw new AppError("CONFLICT", `At most ${MAX_PRODUCTS} products`);
      const names = await this.checkComponents(tx, tenantId, input.components, null);
      const p = await tx.product.insertOne({ ...input, sku: input.sku ?? null, description: input.description ?? null, renewalMonths: input.renewalMonths ?? null, tenantId });
      await this.audit.log(tx, { action: "product.created", entityType: "product", entityId: p.id, diff: { name: p.name, price: p.price } });
      return productDto(p, names);
    });
  }

  async update(id: string, input: ProductInput): Promise<ProductDto> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      const before = await tx.product.findOne({ id, tenantId });
      if (!before) throw notFound("Product");
      const names = await this.checkComponents(tx, tenantId, input.components, id);
      // Documents keep their own copy of each line: a new price only affects new documents
      const p = await tx.product.update({ id }, { $set: { ...input, sku: input.sku ?? null, description: input.description ?? null, renewalMonths: input.renewalMonths ?? null } });
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ["name", "price", "currency", "taxBp", "active"] as const) if (before[key] !== p[key]) diff[key] = { from: before[key], to: p[key] };
      if (Object.keys(diff).length) await this.audit.log(tx, { action: "product.updated", entityType: "product", entityId: id, diff: diff as never });
      return productDto(p, names);
    });
  }

  /** Products already on documents are archived instead, so nothing points at a missing row. */
  async remove(id: string): Promise<{ archived: boolean }> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      const p = await tx.product.findOne({ id, tenantId });
      if (!p) throw notFound("Product");
      const used = await tx.salesDoc.count({ tenantId, "lines.productId": id });
      if (used) {
        await tx.product.update({ id }, { $set: { active: false } });
        await this.audit.log(tx, { action: "product.archived", entityType: "product", entityId: id, diff: { name: p.name } });
        return { archived: true };
      }
      await tx.product.delete({ id });
      await this.audit.log(tx, { action: "product.deleted", entityType: "product", entityId: id, diff: { name: p.name } });
      return { archived: false };
    });
  }

  /** A bundle holds plain products of this company, not itself and not other bundles. */
  private async checkComponents(tx: Tx, tenantId: string, components: { productId: string }[], selfId: string | null) {
    if (!components.length) return new Map<string, string>();
    const ids = [...new Set(components.map((c) => c.productId))];
    const found = await tx.product.find({ tenantId, id: { $in: ids } }, { projection: { id: 1, name: 1, components: 1 } });
    const bad = ids.length !== found.length || ids.includes(selfId ?? "") || found.some((p) => (p.components ?? []).length > 0);
    if (bad) throw new AppError("VALIDATION_FAILED", "A bundle contains plain products of the catalog", { components: ["Invalid component"] });
    if (selfId && (await tx.product.count({ tenantId, "components.productId": selfId }))) {
      throw new AppError("VALIDATION_FAILED", "A product inside a bundle can't become a bundle", { components: ["Nested bundle"] });
    }
    return new Map(found.map((p) => [p.id, p.name]));
  }
}
