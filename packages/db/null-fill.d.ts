import type { Prisma } from "@prisma/client";

/** Writes omitted optional fields as explicit nulls so `{ field: null }` filters match on MongoDB. */
export declare function createNullFill(dmmf: typeof Prisma.dmmf): Prisma.Middleware;
