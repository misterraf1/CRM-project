-- Deal page timeline
CREATE INDEX "Activity_dealId_createdAt_idx" ON "Activity"("dealId", "createdAt");
