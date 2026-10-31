import type { MeResponse, MemberDto, MfaEnabledDto, MfaSetupDto, MySecurityDto } from "@/shared";
import request from "supertest";
import { totp } from "@/server/common/totp";
import { addMember, createApp, PASSWORD, signup, type TestApp } from "./helpers";

const STEP = 30_000;

describe("Two-step sign-in for company members", () => {
  let app: TestApp;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  type Auth = { authorization: string };
  const bearer = (token: string): Auth => ({ authorization: `Bearer ${token}` });
  const login = (email: string) => http().post("/v1/auth/login").send({ email, password: PASSWORD }).expect(200);

  /** Turns 2FA on with the current code; the next code to use is a step later. */
  async function enable(auth: Auth) {
    const setup = (await http().post("/v1/me/security/mfa/setup").set(auth).expect(201)).body as MfaSetupDto;
    expect(setup.otpauthUri).toContain("Axis");
    await http().post("/v1/me/security/mfa/enable").set(auth).send({ code: "000000" }).expect(401);
    const { recoveryCodes } = (await http().post("/v1/me/security/mfa/enable").set(auth).send({ code: totp(setup.secret) }).expect(200)).body as MfaEnabledDto;
    return { secret: setup.secret, recoveryCodes };
  }

  it("with 2FA on, the password only yields a challenge; the code (or a recovery code) completes the sign-in", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    expect(((await http().get("/v1/me/security").set(emp.auth).expect(200)).body as MySecurityDto)).toEqual({ mfaEnabled: false, recoveryCodesLeft: 0, requiredByCompany: false });
    const { secret, recoveryCodes } = await enable(emp.auth);

    const step1 = (await login(emp.email)).body;
    expect(step1).toEqual({ mfaRequired: true, challenge: expect.any(String) });
    // The challenge is not a session
    await http().get("/v1/me").set(bearer(step1.challenge)).expect(401);
    expect((await http().post("/v1/auth/login/mfa").send({ challenge: step1.challenge, code: "123456" }).expect(401)).body.error.code).toBe("MFA_INVALID");
    const ok = (await http().post("/v1/auth/login/mfa").send({ challenge: step1.challenge, code: totp(secret, Date.now() + STEP) }).expect(200)).body;
    expect(((await http().get("/v1/me").set(bearer(ok.accessToken)).expect(200)).body as MeResponse).security).toEqual({ mfaEnabled: true, mfaSetupRequired: false });

    // Recovery code: once
    await http().post("/v1/auth/login/mfa").send({ challenge: (await login(emp.email)).body.challenge, code: recoveryCodes[0] }).expect(200);
    await http().post("/v1/auth/login/mfa").send({ challenge: (await login(emp.email)).body.challenge, code: recoveryCodes[0] }).expect(401);
    // An admin challenge is no good here
    await http().post("/v1/auth/login/mfa").send({ challenge: "not-a-token-at-all", code: recoveryCodes[1] }).expect(401);

    // The owner sees who has it on
    const list = (await http().get("/v1/members").set(owner.auth)).body as MemberDto[];
    expect(list.find((m) => m.id === emp.memberId)?.mfaEnabled).toBe(true);

    await http().post("/v1/me/security/mfa/disable").set(emp.auth).send({ code: "000000" }).expect(401);
  });

  it("the company can require 2FA: members without it can only set it up, then continue", async () => {
    const owner = await signup(app);
    const emp = await addMember(app, owner, "EMPLOYEE");
    await http().patch("/v1/settings/security").set(emp.auth).send({ requireMfa: true }).expect(403);
    // Not before the owner's own account has it
    expect((await http().patch("/v1/settings/security").set(owner.auth).send({ requireMfa: true }).expect(403)).body.error.code).toBe("MFA_SETUP_REQUIRED");
    await enable(owner.auth);
    expect((await http().patch("/v1/settings/security").set(owner.auth).send({ requireMfa: true }).expect(200)).body).toEqual({ requireMfa: true });

    // A fresh sign-in carries the pending setup: everything but the setup is closed
    const tokens = (await login(emp.email)).body;
    const auth = bearer(tokens.accessToken);
    expect((await http().get("/v1/contacts").set(auth).expect(403)).body.error.code).toBe("MFA_SETUP_REQUIRED");
    expect(((await http().get("/v1/me").set(auth).expect(200)).body as MeResponse).security).toEqual({ mfaEnabled: false, mfaSetupRequired: true });
    expect(((await http().get("/v1/me/security").set(auth).expect(200)).body as MySecurityDto).requiredByCompany).toBe(true);
    const { secret } = await enable(auth);

    // The next token (refresh) no longer carries it
    const refreshed = (await http().post("/v1/auth/refresh").send({ refreshToken: tokens.refreshToken }).expect(200)).body;
    await http().get("/v1/contacts").set(bearer(refreshed.accessToken)).expect(200);
    // Mandatory: can't be turned off
    expect((await http().post("/v1/me/security/mfa/disable").set(bearer(refreshed.accessToken)).send({ code: totp(secret, Date.now() + STEP) }).expect(409)).body.error.code).toBe("CONFLICT");

    // Rule off again: the setup is optional
    await http().patch("/v1/settings/security").set(owner.auth).send({ requireMfa: false }).expect(200);
    expect(((await http().get("/v1/me/security").set(auth).expect(200)).body as MySecurityDto).requiredByCompany).toBe(false);
  });
});
