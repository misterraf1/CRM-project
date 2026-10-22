import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";
import { config } from "./config";

async function main() {
  const { API_PORT } = config();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  await app.listen(API_PORT);
  Logger.log(`API listening on http://localhost:${API_PORT}`, "Bootstrap");
}

void main();
