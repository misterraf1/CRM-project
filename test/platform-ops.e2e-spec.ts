import { createServer, type Server } from "node:http";
import type { SystemHealthDto } from "@/shared";
import request from "supertest";
import { ErrorReporter } from "@/server/common/error-reporter";
import { JobsMonitor } from "@/server/common/jobs-monitor";
import { S3FileStorage } from "@/server/storage/storage.service";
import { createApp, platformStaff, type TestApp } from "./helpers";

const FAKE_S3_PORT = 55991;
Object.assign(process.env, {
  S3_BUCKET: "axis-test",
  S3_ENDPOINT: `http://127.0.0.1:${FAKE_S3_PORT}`,
  S3_REGION: "auto",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
  S3_FORCE_PATH_STYLE: "true",
});


/** A path-style S3 endpoint keeping objects in memory: PUT, GET and DELETE are all the driver uses. */
function fakeS3() {
  const objects = new Map<string, Buffer>();
  const server: Server = createServer(async (req, res) => {
    const key = decodeURIComponent(req.url!.split("?")[0]!);
    if (!req.headers.authorization?.startsWith("AWS4-HMAC-SHA256")) return res.writeHead(403).end();
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      objects.set(key, Buffer.concat(chunks));
      return res.writeHead(200, { etag: '"x"' }).end();
    }
    if (req.method === "GET") {
      const body = objects.get(key);
      if (!body) return res.writeHead(404, { "content-type": "application/xml" }).end("<Error><Code>NoSuchKey</Code></Error>");
      return res.writeHead(200, { "content-length": body.length, "content-type": "application/octet-stream" }).end(body);
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      return res.writeHead(204).end();
    }
    res.writeHead(405).end();
  });
  return { objects, server };
}

describe("Production operations", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());
  const s3 = fakeS3();

  beforeAll(async () => {
    await new Promise<void>((resolve) => s3.server.listen(FAKE_S3_PORT, "127.0.0.1", resolve));
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => s3.server.close(resolve));
  });

  it("S3 storage: put, read back and remove under the same key", async () => {
    const storage = new S3FileStorage();
    const key = "tenants/t1/file-1";
    await storage.put(key, Buffer.from("müqavilə məzmunu"));
    expect(s3.objects.get(`/axis-test/${key}`)?.toString()).toBe("müqavilə məzmunu");

    const chunks: Buffer[] = [];
    for await (const c of await storage.read(key)) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).toString()).toBe("müqavilə məzmunu");

    await storage.remove(key);
    expect(s3.objects.has(`/axis-test/${key}`)).toBe(false);
  });

  it("unexpected errors are grouped and shown on the System page", async () => {
    const admin = await platformStaff(app, "SUPER_ADMIN");
    const reporter = app.get(ErrorReporter);
    // Same throw site, different ids → one row counted twice
    const fail = (id: string) => new Error(`Deal ${id} not loaded`);
    reporter.capture("api", fail("6650a1b2c3d4e5f6a7b8c9d0"), "GET /v1/test-errors/:id");
    reporter.capture("api", fail("77aa1b2c3d4e5f6a7b8c9d01"), "GET /v1/test-errors/:id");
    // A failing job run is recorded too, without breaking the monitor
    await app.get(JobsMonitor).track("test-job", async () => {
      throw new Error("job exploded");
    });
    await reporter.flush();

    const s = (await http().get("/v1/admin/system").set(admin.auth).expect(200)).body as SystemHealthDto;
    const api = s.errors.recent.find((e) => e.where === "GET /v1/test-errors/:id");
    expect(api).toMatchObject({ source: "api", count: 2 });
    expect(s.errors.recent.find((e) => e.where === "test-job")).toMatchObject({ source: "job", message: "job exploded", count: 1 });
    expect(s.errors.last24h).toBeGreaterThanOrEqual(2);
    expect(s.storage).toEqual({ driver: "local", persistent: true });
    expect(s.cronConfigured).toBe(true);
  });
});
