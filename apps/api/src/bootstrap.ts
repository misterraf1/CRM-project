import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { config } from "./config";

/** Shared by main.ts and the e2e tests so both run the same HTTP stack. */
export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  express.set("trust proxy", config().TRUST_PROXY);
  express.disable("x-powered-by");
  express.use(helmet());
  express.useBodyParser("json", { limit: "1mb" });
  app.enableCors({ origin: config().WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  return app;
}
