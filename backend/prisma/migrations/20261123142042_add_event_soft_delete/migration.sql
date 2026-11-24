-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "deletedAt" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "Event_ownerId_deletedAt_idx" ON "Event"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "Event_deletedAt_idx" ON "Event"("deletedAt");
