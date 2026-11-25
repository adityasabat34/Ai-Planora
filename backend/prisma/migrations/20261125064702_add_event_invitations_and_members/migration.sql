-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateTable
CREATE TABLE "EventInvitation" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "inviteeEmail" VARCHAR(254) NOT NULL,
    "inviteeUserId" UUID,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "respondedAt" TIMESTAMPTZ,
    "emailTokenHash" VARCHAR(64),

    CONSTRAINT "EventInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMember" (
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "privateNote" TEXT,

    CONSTRAINT "EventMember_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventInvitation_emailTokenHash_key" ON "EventInvitation"("emailTokenHash");

-- CreateIndex
CREATE INDEX "EventInvitation_inviteeUserId_createdAt_idx" ON "EventInvitation"("inviteeUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventInvitation_eventId_inviteeEmail_key" ON "EventInvitation"("eventId", "inviteeEmail");

-- CreateIndex
CREATE INDEX "EventMember_userId_eventId_idx" ON "EventMember"("userId", "eventId");

-- AddForeignKey
ALTER TABLE "EventInvitation" ADD CONSTRAINT "EventInvitation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInvitation" ADD CONSTRAINT "EventInvitation_inviteeUserId_fkey" FOREIGN KEY ("inviteeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMember" ADD CONSTRAINT "EventMember_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMember" ADD CONSTRAINT "EventMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
