BEGIN;

ALTER TABLE "EventInvitation" ADD COLUMN "emailRetryAt" TIMESTAMPTZ;

-- An organizer can repeat a pending invitation from before the switch to plain registration links.
UPDATE "EventInvitation"
SET "emailRetryAt" = CURRENT_TIMESTAMP
WHERE "status" = 'PENDING' AND "expiresAt" > CURRENT_TIMESTAMP;

-- Include invitations sent before an existing account was registered.
UPDATE "EventInvitation" AS i
SET "inviteeUserId" = u."id"
FROM "User" AS u
WHERE i."inviteeUserId" IS NULL AND i."inviteeEmail" = u."email";

CREATE INDEX "EventInvitation_inviteeEmail_inviteeUserId_idx"
    ON "EventInvitation"("inviteeEmail", "inviteeUserId");
ALTER TABLE "EventInvitation" DROP COLUMN "emailTokenHash";
ALTER TABLE "User" DROP COLUMN "emailVerifiedAt";

COMMIT;
