import type { AdminMe, MfaEnabledDto, MfaSetupDto } from "@/shared";
import request from "supertest";
import { config } from "@/server/config";
import { totp } from "@/server/common/totp";
import { createApp, platformStaff, PASSWORD, type TestApp } from "./helpers";

const STEP = 30_000;

describe("Platform staff 2FA", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  /** Staff member with 2FA turned on; returns the key and recovery codes. */
  async function withMfa() {
    const staff = await platformStaff(app, "SUPER_ADMIN");
    const setup = (await http().post("/v1/admin/auth/mfa/setup").set(staff.auth).expect(201)).body as MfaSetupDto;
    expect(setup.otpauthUri).toContain(`secret=${setup.secret}`);
    expect(setup.qrSvg).toContain("<svg");
    const wrong = await http().post("/v1/admin/auth/mfa/enable").set(staff.auth).send({ code: "000000" }).expect(401);
    expect(wrong.body.error.code).toBe("MFA_INVALID");
    const enabled = (await http().post("/v1/admin/auth/mfa/enable").set(staff.auth).send({ code: totp(setup.secret) }).expect(200)).body as MfaEnabledDto;
    expect(enabled.recoveryCodes).toHaveLength(10);
    return { ...staff, secret: setup.secret, recoveryCodes: enabled.recoveryCodes };
  }

  const login = (email: string) => http().post("/v1/admin/auth/login").send({ email, password: PASSWORD }).expect(200);

  it("with 2FA on, the password only yields a challenge; codes work once; the challenge is not a session", async () => {
    const staff = await withMfa();
    expect(((await http().get("/v1/admin/auth/me").set(staff.auth).expect(200)).body as AdminMe)).toMatchObject({ mfaEnabled: true, recoveryCodesLeft: 10 });

    const step1 = (await login(staff.email)).body;
    expect(step1).toEqual({ mfaRequired: true, challenge: expect.any(String) });
    expect(step1.accessToken).toBeUndefined();
    await http().get("/v1/admin/overview").set({ authorization: `Bearer ${step1.challenge}` }).expect(401);

    const bad = await http().post("/v1/admin/auth/mfa/verify").send({ challenge: step1.challenge, code: "123456" }).expect(401);
    expect(bad.body.error.code).toBe("MFA_INVALID");
    // The code used to enable 2FA can't be replayed; the next 30-second code works once
    const next = totp(staff.secret, Date.now() + STEP);
    const ok = (await http().post("/v1/admin/auth/mfa/verify").send({ challenge: step1.challenge, code: next }).expect(200)).body;
    await http().get("/v1/admin/overview").set({ authorization: `Bearer ${ok.accessToken}` }).expect(200);
    await http().post("/v1/admin/auth/mfa/verify").send({ challenge: (await login(staff.email)).body.challenge, code: next }).expect(401);

    // Recovery code: once
    const challenge = (await login(staff.email)).body.challenge;
    const rec = staff.recoveryCodes[0]!.toLowerCase().replace("-", " ");
    await http().post("/v1/admin/auth/mfa/verify").send({ challenge, code: rec }).expect(200);
    await http().post("/v1/admin/auth/mfa/verify").send({ challenge: (await login(staff.email)).body.challenge, code: staff.recoveryCodes[0] }).expect(401);
    expect(((await http().get("/v1/admin/auth/me").set(staff.auth).expect(200)).body as AdminMe).recoveryCodesLeft).toBe(9);

    await http().post("/v1/admin/auth/mfa/verify").send({ challenge: "not-a-token-at-all", code: next }).expect(401);
    // A challenge is not a tenant token either
    await http().get("/v1/me").set({ authorization: `Bearer ${step1.challenge}` }).expect(401);
  });

  it("disable needs a valid code; afterwards the password alone signs in again", async () => {
    const staff = await withMfa();
    await http().post("/v1/admin/auth/mfa/disable").set(staff.auth).send({ code: "000000" }).expect(401);
    await http().post("/v1/admin/auth/mfa/disable").set(staff.auth).send({ code: totp(staff.secret, Date.now() + STEP) }).expect(204);
    expect((await login(staff.email)).body.accessToken).toEqual(expect.any(String));
  });

  it("where 2FA is mandatory, staff without it can only set it up", async () => {
    const cfg = config() as { PLATFORM_REQUIRE_MFA: boolean };
    cfg.PLATFORM_REQUIRE_MFA = true;
    try {
      const staff = await platformStaff(app, "SUPPORT");
      const blocked = await http().get("/v1/admin/overview").set(staff.auth).expect(403);
      expect(blocked.body.error.code).toBe("MFA_SETUP_REQUIRED");
      expect(((await http().get("/v1/admin/auth/me").set(staff.auth).expect(200)).body as AdminMe)).toMatchObject({ mfaRequired: true, mfaEnabled: false });
      const setup = (await http().post("/v1/admin/auth/mfa/setup").set(staff.auth).expect(201)).body as MfaSetupDto;
      await http().post("/v1/admin/auth/mfa/enable").set(staff.auth).send({ code: totp(setup.secret) }).expect(200);
      await http().get("/v1/admin/overview").set(staff.auth).expect(200);
      // Can't be switched off while mandatory
      await http().post("/v1/admin/auth/mfa/disable").set(staff.auth).send({ code: totp(setup.secret, Date.now() + STEP) }).expect(409);
    } finally {
      cfg.PLATFORM_REQUIRE_MFA = false;
    }
  });
});
