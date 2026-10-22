import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { requestContext } from "./context";

@Injectable()
export class ContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    requestContext.run({ ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) }, next);
  }
}
