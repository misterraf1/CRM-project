import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  commentSchema,
  projectSchema,
  taskCreateSchema,
  taskListQuerySchema,
  taskUpdateSchema,
  type ProjectInput,
  type TaskCreateInput,
  type TaskListQuery,
  type TaskUpdateInput,
} from "@axis/shared";
import type { Response } from "express";
import type { z } from "zod";
import { config } from "../config";
import { ZodPipe } from "../common/zod.pipe";
import { FilesService, type UploadedFile as Upload } from "./files.service";
import { ProjectsService } from "./projects.service";
import { TasksService } from "./tasks.service";

@Controller("v1")
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly files: FilesService,
    private readonly projects: ProjectsService,
  ) {}

  @Get("tasks")
  list(@Query(new ZodPipe(taskListQuerySchema)) query: TaskListQuery) {
    return this.tasks.list(query);
  }

  @Post("tasks")
  create(@Body(new ZodPipe(taskCreateSchema)) body: TaskCreateInput) {
    return this.tasks.create(body);
  }

  @Get("tasks/:id")
  get(@Param("id") id: string) {
    return this.tasks.get(id);
  }

  @Patch("tasks/:id")
  update(@Param("id") id: string, @Body(new ZodPipe(taskUpdateSchema)) body: TaskUpdateInput) {
    return this.tasks.update(id, body);
  }

  @HttpCode(204)
  @Delete("tasks/:id")
  remove(@Param("id") id: string) {
    return this.tasks.remove(id);
  }

  @Post("tasks/:id/comments")
  comment(@Param("id") id: string, @Body(new ZodPipe(commentSchema)) body: z.infer<typeof commentSchema>) {
    return this.tasks.addComment(id, body.body);
  }

  @Post("tasks/:id/files")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: config().MAX_UPLOAD_MB * 1024 * 1024, files: 1 } }))
  upload(@Param("id") id: string, @UploadedFile() file: Upload | undefined) {
    return this.files.uploadToTask(id, file);
  }

  @Get("files/:id")
  async download(@Param("id") id: string, @Res() res: Response) {
    const { file, stream } = await this.files.open(id);
    res.set({
      // Always a download, never rendered in our origin (uploaded HTML/SVG can't run)
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "content-length": String(file.sizeBytes),
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    });
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  }

  @HttpCode(204)
  @Delete("files/:id")
  removeFile(@Param("id") id: string) {
    return this.files.remove(id);
  }

  @Get("projects")
  projectList() {
    return this.projects.list();
  }

  @Post("projects")
  projectCreate(@Body(new ZodPipe(projectSchema)) body: ProjectInput) {
    return this.projects.create(body);
  }

  @Patch("projects/:id")
  projectUpdate(@Param("id") id: string, @Body(new ZodPipe(projectSchema.partial())) body: Partial<ProjectInput>) {
    return this.projects.update(id, body);
  }
}
