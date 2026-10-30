import type { ProductDto, ProductInput } from "@/shared";
import { AuditService } from "../audit/audit.service";
import { authedContext } from "../common/context";
import { AppError, notFound } from "../common/errors";
import type { Database } from "../db/database";
import type { Product } from "../db/models";

const MAX_PRODUCTS = 2000;

export const productDto = (p: Product): ProductDto => ({
  id: p.id,
  name: p.name,
  sku: p.sku,
  description: p.description,
  unit: p.unit,
  price: p.price,
  currency: p.currency,
  taxBp: p.taxBp,
  active: p.active,
});

/** The company's catalog: what quotes and invoices are made of. Everyone reads it; managing it is a permission. */
export class ProductsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false): Promise<ProductDto[]> {
    const { tenantId } = authedContext();
    const rows = await this.db.scoped((tx) => tx.product.find({ tenantId, ...(includeInactive ? {} : { active: true }) }, { sort: { name: 1 }, limit: MAX_PRODUCTS }));
    return rows.map(productDto);
  }

  async create(input: ProductInput): Promise<ProductDto> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      if ((await tx.product.count({ tenantId })) >= MAX_PRODUCTS) throw new AppError("CONFLICT", `At most ${MAX_PRODUCTS} products`);
      const p = await tx.product.insertOne({ ...input, sku: input.sku ?? null, description: input.description ?? null, tenantId });
      await this.audit.log(tx, { action: "product.created", entityType: "product", entityId: p.id, diff: { name: p.name, price: p.price } });
      return productDto(p);
    });
  }

  async update(id: string, input: ProductInput): Promise<ProductDto> {
    const { tenantId } = authedContext();
    return this.db.scoped(async (tx) => {
      const before = await tx.product.findOne({ id, tenantId });
      if (!before) throw notFound("Product");
      // Documents keep their own copy of each line: a new price only affects new documents
      const p = await tx.product.update({ id }, { $set: { ...input, sku: input.sku ?? null, description: input.description ?? null } });
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ["name", "price", "currency", "taxBp", "active"] as const) if (before[key] !== p[key]) diff[key] = { from: before[key], to: p[key] };
      if (Object.keys(diff).length) await this.audit.log(tx, { action: "product.updated", entityType: "product", entityId: id, diff: diff as never });
      return productDto(p);
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
}
