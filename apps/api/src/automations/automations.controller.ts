import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { automationRuleSchema, automationRuleUpdateSchema, type AutomationRuleInput } from "@axis/shared";
import { RequireFeature, RequirePermission } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { AutomationsService } from "./automations.service";

@RequireFeature("automations")
@RequirePermission("automations.manage")
@Controller("v1/automations")
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get()
  list() {
    return this.automations.list();
  }

  @Post()
  create(@Body(new ZodPipe(automationRuleSchema)) body: AutomationRuleInput) {
    return this.automations.create(body);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodPipe(automationRuleUpdateSchema)) body: Partial<AutomationRuleInput>) {
    return this.automations.update(id, body);
  }

  @HttpCode(204)
  @Delete(":id")
  async remove(@Param("id") id: string) {
    await this.automations.remove(id);
  }

  @Get(":id/runs")
  runs(@Param("id") id: string) {
    return this.automations.runs(id);
  }
}
