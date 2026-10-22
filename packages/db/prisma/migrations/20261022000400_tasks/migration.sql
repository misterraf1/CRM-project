ALTER TABLE "Task" ADD COLUMN "overdueNotifiedAt" TIMESTAMP(3);

-- The overdue-notice job runs outside any request, so it has no tenant context and
-- RLS hides every task from it. This function exposes only the ids it needs (no
-- titles, no other columns); the job then handles each task inside a normal
-- tenant-scoped transaction. Timestamps are stored as UTC without time zone.
CREATE FUNCTION tasks_due_for_overdue_notice(max_rows integer)
  RETURNS TABLE ("tenantId" text, "taskId" text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT t."tenantId", t.id
  FROM "Task" t
  WHERE t."dueAt" < (now() AT TIME ZONE 'UTC')
    AND t.status NOT IN ('DONE', 'CANCELED')
    AND t."overdueNotifiedAt" IS NULL
    AND t."assigneeId" IS NOT NULL
  ORDER BY t."dueAt"
  LIMIT max_rows
$$;

REVOKE ALL ON FUNCTION tasks_due_for_overdue_notice(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tasks_due_for_overdue_notice(integer) TO axis_app;

CREATE INDEX "Task_tenantId_parentId_idx" ON "Task"("tenantId", "parentId");
