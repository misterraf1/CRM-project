import { Controller, Get, Param, Query } from "@nestjs/common";
import { teamStatsQuerySchema } from "@axis/shared";
import type { z } from "zod";
import { RequireFeature } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { TeamService } from "./team.service";

// Employee monitoring: PRO and up
@RequireFeature("team.monitoring")
@Controller("v1/team")
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get("stats")
  stats(@Query(new ZodPipe(teamStatsQuerySchema)) query: z.infer<typeof teamStatsQuerySchema>) {
    return this.team.stats(query.period);
  }

  @Get(":memberId")
  profile(@Param("memberId") memberId: string) {
    return this.team.profile(memberId);
  }
}
