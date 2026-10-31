import { addonsSchema, checkoutSchema, demoCompleteSchema, demoNextChargeSchema, downgradeSchema } from "@/shared";
import { authedContext } from "../common/context";
import type { Services } from "../container";
import type { Router } from "../http/router";

// Owners only; usable while suspended so a company can always pay to reactivate.
export function billingRoutes(router: Router, s: Services) {
  router.group("/v1/billing", { allowInactive: true, permission: "billing.manage" }, (r) => {
    r.get("", () => s.billing.overview());

    r.post("checkout", { body: checkoutSchema }, ({ body }) => s.billing.checkout(body));

    r.get("invoices/:id", ({ params }) => s.billing.invoice(params.id!));

    r.post("invoices/:id/pay", ({ params }) => s.billing.pay(params.id!));

    r.post("downgrade", { status: 204, body: downgradeSchema }, ({ body }) => s.billing.downgrade(body.planCode));

    r.delete("downgrade", { status: 204 }, () => s.billing.cancelDowngrade());

    r.post("cancel", { status: 204 }, () => s.billing.setCancelAtPeriodEnd(true));

    r.post("resume", { status: 204 }, () => s.billing.setCancelAtPeriodEnd(false));

    r.post("addons", { body: addonsSchema }, ({ body }) => s.billing.addons(body));

    // ── Demo provider controls ──
    r.post("demo/invoices/:id/complete", { status: 200, body: demoCompleteSchema }, ({ params, body }) => s.billing.demoComplete(params.id!, body.outcome));

    r.post("demo/next-charge", { status: 204, body: demoNextChargeSchema }, ({ body }) => s.billing.demoNextCharge(body.fails));

    r.post("demo/advance", async () => {
      await s.billingJob.demoAdvance(authedContext().tenantId);
      return s.billing.overview();
    });
  });

  // The website's pricing: public plans only, no session
  router.group("/v1/public", { public: true }, (r) => {
    r.get("plans", { throttle: { limit: 60, ttl: 60_000 } }, () => s.billing.publicPlans());
  });
}
