import { forgotPasswordSchema, loginSchema, refreshSchema, resetPasswordSchema, signupSchema, switchTenantSchema } from "@/shared";
import { config } from "../config";
import type { Services } from "../container";
import type { Router } from "../http/router";

const authLimit = { limit: () => config().AUTH_RATE_LIMIT, ttl: 60_000 };

export function authRoutes(router: Router, s: Services) {
  router.group("/v1/auth", {}, (r) => {
    r.post("signup", { public: true, throttle: authLimit, body: signupSchema }, ({ body }) => s.auth.signup(body));

    r.post("login", { public: true, throttle: authLimit, status: 200, body: loginSchema }, ({ body }) => s.auth.login(body));

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

    r.post("switch", { allowInactive: true, status: 200, body: switchTenantSchema }, ({ body }) => s.auth.switchTenant(body.tenantId));
  });

  router.group("/v1/me", {}, (r) => {
    r.get("", () => s.auth.me());
  });
}
