import { Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodTypeAny, z } from "zod";
import { AppError } from "./errors";

@Injectable()
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppError("VALIDATION_FAILED", "Invalid request body", result.error.flatten().fieldErrors);
    }
    return result.data;
  }
}
