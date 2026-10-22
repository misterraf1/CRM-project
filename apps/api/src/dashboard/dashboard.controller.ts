import { Controller, Get, Query } from "@nestjs/common";
import { dashboardQuerySchema } from "@axis/shared";
import type { z } from "zod";
import { ZodPipe } from "../common/zod.pipe";
import { DashboardService } from "./dashboard.service";

@Controller("v1/dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@Query(new ZodPipe(dashboardQuerySchema)) query: z.infer<typeof dashboardQuerySchema>) {
    return this.dashboard.crm(query.period);
  }
}
