import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "./common/decorators";
import { PrismaService } from "./prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check() {
    await this.prisma.ping();
    return { status: "ok" };
  }
}
