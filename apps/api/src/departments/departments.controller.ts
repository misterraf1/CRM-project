import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { departmentSchema, type DepartmentInput } from "@axis/shared";
import { RequirePermission } from "../common/decorators";
import { ZodPipe } from "../common/zod.pipe";
import { DepartmentsService } from "./departments.service";

@Controller("v1/departments")
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @RequirePermission("members.view")
  @Get()
  list() {
    return this.departments.list();
  }

  @RequirePermission("departments.manage")
  @Post()
  create(@Body(new ZodPipe(departmentSchema)) body: DepartmentInput) {
    return this.departments.create(body);
  }

  @RequirePermission("departments.manage")
  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodPipe(departmentSchema)) body: DepartmentInput) {
    return this.departments.update(id, body);
  }

  @RequirePermission("departments.manage")
  @HttpCode(204)
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.departments.remove(id);
  }
}
