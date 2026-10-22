import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { Prisma } from "@prisma/client";
import type { ApiError, ErrorCode } from "@axis/shared";
import type { Response } from "express";
import { AppError } from "./errors";

const HTTP_CODES: Record<number, ErrorCode> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "RATE_LIMITED",
};

/** Every error leaves the API as `{ error: { code, message, details? } }`. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("Error");

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.toResponse(exception);
    res.status(status).json(body);
  }

  private toResponse(e: unknown): { status: number; body: ApiError } {
    const make = (status: number, code: ErrorCode, message: string, details?: unknown) => ({
      status,
      body: { error: details === undefined ? { code, message } : { code, message, details } },
    });

    if (e instanceof AppError) return make(e.status, e.code, e.message, e.details);
    if (e instanceof ThrottlerException) return make(429, "RATE_LIMITED", "Too many requests");
    if (e instanceof HttpException) {
      const status = e.getStatus();
      return make(status, HTTP_CODES[status] ?? "INTERNAL", e.message);
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") return make(409, "CONFLICT", "Already exists", { fields: e.meta?.target });
      if (e.code === "P2025") return make(404, "NOT_FOUND", "Not found");
    }
    this.logger.error(e instanceof Error ? e.stack : String(e));
    return make(500, "INTERNAL", "Internal server error");
  }
}
