ALTER TABLE "Channel" ADD COLUMN "demo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Channel" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Conversation" ADD COLUMN "displayName" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "handle" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "lastInboundAt" TIMESTAMP(3);

-- Provider webhooks arrive without tenant context (Meta only tells us the phone
-- number id / page id). This resolves exactly one live channel to its tenant and
-- exposes nothing else; processing then continues in a tenant-scoped transaction.
CREATE FUNCTION channel_for_webhook(p_type text, p_external_id text)
  RETURNS TABLE ("tenantId" text, "channelId" text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT c."tenantId", c.id FROM "Channel" c
  WHERE c.type::text = p_type AND c."externalId" = p_external_id AND c.demo = false AND c.status <> 'disconnected'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION channel_for_webhook(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION channel_for_webhook(text, text) TO axis_app;
