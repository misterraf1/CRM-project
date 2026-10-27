import { commentSchema, fileListQuerySchema, projectSchema, taskCreateSchema, taskListQuerySchema, taskUpdateSchema } from "@/shared";
import { Readable } from "node:stream";
import type { Services } from "../container";
import type { Router } from "../http/router";

export function tasksRoutes(router: Router, s: Services) {
  router.group("/v1", {}, (r) => {
    r.get("tasks", { query: taskListQuerySchema }, ({ query }) => s.tasks.list(query));

    r.post("tasks", { body: taskCreateSchema }, ({ body }) => s.tasks.create(body));

    r.get("tasks/:id", ({ params }) => s.tasks.get(params.id!));

    r.patch("tasks/:id", { body: taskUpdateSchema }, ({ params, body }) => s.tasks.update(params.id!, body));

    r.delete("tasks/:id", { status: 204 }, ({ params }) => s.tasks.remove(params.id!));

    r.post("tasks/:id/comments", { body: commentSchema }, ({ params, body }) => s.tasks.addComment(params.id!, body.body));

    r.post("tasks/:id/files", { upload: true }, ({ params, file }) => s.files.uploadToTask(params.id!, file));

    /** The Files section: everything the caller may open, plus storage usage */
    r.get("files", { query: fileListQuerySchema }, ({ query }) => s.files.list(query));

    /** Company library: shared documents not tied to a task or chat */
    r.post("files", { upload: true }, ({ file }) => s.files.uploadToLibrary(file));

    r.get("files/:id", async ({ params }) => {
      const { file, stream } = await s.files.open(params.id!);
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        headers: {
          // Always a download, never rendered in our origin (uploaded HTML/SVG can't run)
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "content-length": String(file.sizeBytes),
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox",
        },
      });
    });

    r.delete("files/:id", { status: 204 }, ({ params }) => s.files.remove(params.id!));

    r.get("projects", () => s.projects.list());

    r.post("projects", { body: projectSchema }, ({ body }) => s.projects.create(body));

    r.patch("projects/:id", { body: projectSchema.partial() }, ({ params, body }) => s.projects.update(params.id!, body));
  });
}
