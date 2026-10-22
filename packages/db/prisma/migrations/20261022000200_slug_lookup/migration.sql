-- Signup needs to know whether a workspace address is taken, but other tenants'
-- rows are invisible under RLS. This exposes only a boolean for one slug — the
-- same information a subdomain lookup reveals publicly.
CREATE FUNCTION tenant_slug_taken(candidate text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM "Tenant" WHERE slug = candidate) $$;

REVOKE ALL ON FUNCTION tenant_slug_taken(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_slug_taken(text) TO axis_app;
