-- Tenant isolation enforced by PostgreSQL itself (defence in depth).
--
-- The API runs each request in a transaction that first calls
--   SELECT set_config('app.tenant_id', <tenant>, true), set_config('app.user_id', <user>, true);
-- and connects as `axis_app`, which is neither table owner nor BYPASSRLS. If a query
-- forgets its tenant filter, these policies still return nothing from other tenants.
-- Missing settings evaluate to NULL, so an unset context fails closed (no rows).
--
-- The role is provisioned outside migrations (dev: packages/db/scripts/pg.mjs,
-- prod: infrastructure), so no password ever lives in SQL.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'axis_app') THEN
    RAISE EXCEPTION 'Role "axis_app" must exist before running migrations';
  END IF;
END $$;

CREATE FUNCTION app_tenant_id() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.tenant_id', true), '') $$;

CREATE FUNCTION app_user_id() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;

-- ── Privileges ────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO axis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO axis_app;
GRANT EXECUTE ON FUNCTION app_tenant_id(), app_user_id() TO axis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO axis_app;

-- Platform tables: plans are read-only for tenants, finance and migrations are off-limits.
REVOKE INSERT, UPDATE, DELETE ON "Plan" FROM axis_app;
REVOKE ALL ON "PlatformExpense" FROM axis_app;
REVOKE ALL ON "_prisma_migrations" FROM axis_app;

-- ── Generic policy: every table with a "tenantId" column ──────
-- Session is excluded: refresh tokens are looked up by hash before any context exists.
-- Membership has its own policy below.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.column_name = 'tenantId'
      AND c.table_name NOT IN ('Session', 'Membership')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_tenant_id()) WITH CHECK ("tenantId" = app_tenant_id())',
      t);
  END LOOP;
END $$;

-- ── Membership: own tenant, plus the caller's own memberships in other tenants ──
-- (needed to list "my workspaces" at login and when switching company).
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_isolation ON "Membership"
  USING ("tenantId" = app_tenant_id() OR "userId" = app_user_id())
  WITH CHECK ("tenantId" = app_tenant_id());

-- ── Tenant: the current tenant and tenants the caller belongs to ──
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON "Tenant"
  USING (
    id = app_tenant_id()
    OR EXISTS (SELECT 1 FROM "Membership" m WHERE m."tenantId" = "Tenant".id AND m."userId" = app_user_id())
  )
  WITH CHECK (id = app_tenant_id());
