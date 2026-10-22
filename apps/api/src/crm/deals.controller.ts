import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  dealCreateSchema,
  dealListQuerySchema,
  dealMoveSchema,
  dealUpdateSchema,
  type DealCreateInput,
  type DealListQuery,
  type DealMoveInput,
  type DealUpdateInput,
} from "@axis/shared";
import { z } from "zod";
import { RequirePermission } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { DealsService } from "./deals.service";

const forecastQuery = z.object({ pipelineId: z.string().min(1).max(64).optional() });

@Controller("v1")
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get("pipelines")
  pipelines() {
    return this.deals.pipelines();
  }

  @Get("deals")
  list(@Query(new ZodPipe(dealListQuerySchema)) query: DealListQuery) {
    return this.deals.list(query);
  }

  // Declared before :id so "forecast" isn't captured as an id
  @Get("deals/forecast")
  forecast(@Query(new ZodPipe(forecastQuery)) query: z.infer<typeof forecastQuery>) {
    return this.deals.forecast(query.pipelineId);
  }

  @Post("deals")
  create(@Body(new ZodPipe(dealCreateSchema)) body: DealCreateInput) {
    return this.deals.create(body);
  }

  @Get("deals/:id")
  get(@Param("id") id: string) {
    return this.deals.get(id);
  }

  @Patch("deals/:id")
  update(@Param("id") id: string, @Body(new ZodPipe(dealUpdateSchema)) body: DealUpdateInput) {
    return this.deals.update(id, body);
  }

  @HttpCode(200)
  @Post("deals/:id/move")
  move(@Param("id") id: string, @Body(new ZodPipe(dealMoveSchema)) body: DealMoveInput) {
    return this.deals.move(id, body);
  }

  @RequirePermission("deals.delete")
  @HttpCode(204)
  @Delete("deals/:id")
  remove(@Param("id") id: string) {
    return this.deals.remove(id);
  }
}
