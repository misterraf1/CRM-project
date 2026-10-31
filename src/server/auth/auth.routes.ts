import { companySecuritySchema, forgotPasswordSchema, loginMfaSchema, loginSchema, mfaCodeSchema, refreshSchema, resetPasswordSchema, signupSchema, switchTenantSchema } from "@/shared";
import { config } from "../config";
import type { Services } from "../container";
import type { Router } from "../http/router";

const authLimit = { limit: () => config().AUTH_RATE_LIMIT, ttl: 60_000 };

export function authRoutes(router: Router, s: Services) {
  router.group("/v1/auth", {}, (r) => {
    r.post("signup", { public: true, throttle: authLimit, body: signupSchema }, ({ body }) => s.auth.signup(body));

    r.post("login", { public: true, throttle: authLimit, status: 200, body: loginSchema }, ({ body }) => s.auth.login(body));

    /** Second step for accounts with 2FA: authenticator or recovery code */
    r.post("login/mfa", { public: true, throttle: authLimit, status: 200, body: loginMfaSchema }, ({ body }) => s.auth.verifyMfa(body.challenge, body.code));

    /** Always 204, whether or not the email has an account */
    r.post("password/forgot", { public: true, throttle: authLimit, status: 204, body: forgotPasswordSchema }, async ({ body }) => {
      await s.passwordReset.request(body.email);
    });

    r.post("password/reset", { public: true, throttle: authLimit, status: 204, body: resetPasswordSchema }, async ({ body }) => {
      await s.passwordReset.reset(body.token, body.password);
    });

    r.post("refresh", { public: true, status: 200, body: refreshSchema }, ({ body }) => s.tokens.rotate(body.refreshToken));

    r.post("logout", { public: true, status: 204, body: refreshSchema }, async ({ body }) => {
      await s.tokens.revokeByRefreshToken(body.refreshToken);
    });

    r.post("switch", { allowInactive: true, withoutMfa: true, status: 200, body: switchTenantSchema }, ({ body }) => s.auth.switchTenant(body.tenantId));
  });

  router.group("/v1/me", {}, (r) => {
    r.get("", { withoutMfa: true }, () => s.auth.me());
  });

  // Own 2FA: reachable while the company still waits for it to be set up
  router.group("/v1/me/security", { allowInactive: true }, (r) => {
    r.get("", { withoutMfa: true }, () => s.auth.mySecurity());
    r.post("mfa/setup", { withoutMfa: true }, () => s.auth.setupMfa());
    r.post("mfa/enable", { withoutMfa: true, throttle: authLimit, status: 200, body: mfaCodeSchema }, ({ body }) => s.auth.enableMfa(body.code));
    r.post("mfa/recovery-codes", { throttle: authLimit, status: 200, body: mfaCodeSchema }, ({ body }) => s.auth.regenerateRecoveryCodes(body.code));
    r.post("mfa/disable", { throttle: authLimit, status: 204, body: mfaCodeSchema }, async ({ body }) => {
      await s.auth.disableMfa(body.code);
    });
  });

  router.group("/v1/settings/security", { permission: "members.manage" }, (r) => {
    r.get("", () => s.auth.companySecurity());
    r.patch("", { body: companySecuritySchema }, ({ body }) => s.auth.setCompanySecurity(body));
  });
}
