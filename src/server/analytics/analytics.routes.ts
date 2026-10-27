import { Controller, Get, Header, Query } from "@nestjs/common";
import { analyticsQuerySchema, type AnalyticsPeriod } from "@axis/shared";
import { RequireFeature, RequirePermission } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { AnalyticsService } from "./analytics.service";

@RequirePermission("analytics.view")
@Controller("v1/analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @RequireFeature("analytics.basic")
  @Get("basic")
  basic(@Query(new ZodPipe(analyticsQuerySchema)) q: { period: AnalyticsPeriod }) {
    return this.analytics.basic(q.period);
  }

  @RequireFeature("analytics.advanced")
  @Get("advanced")
  advanced(@Query(new ZodPipe(analyticsQuerySchema)) q: { period: AnalyticsPeriod }) {
    return this.analytics.advanced(q.period);
  }

  // Exporting is a separate right: managers may analyse without taking the data out
  @RequireFeature("analytics.advanced")
  @RequirePermission("deals.export")
  @Get("export/deals.csv")
  @Header("content-type", "text/csv; charset=utf-8")
  @Header("content-disposition", 'attachment; filename="deals.csv"')
  @Header("cache-control", "no-store")
  exportDeals(@Query(new ZodPipe(analyticsQuerySchema)) q: { period: AnalyticsPeriod }) {
    return this.analytics.exportDeals(q.period);
  }
}
