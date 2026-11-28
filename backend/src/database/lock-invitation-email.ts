import type { Prisma } from '../generated/prisma/client.js';

export async function lockInvitationEmail(tx: Prisma.TransactionClient, email: string) {
  // Signup and an invitation can arrive together before an account row exists to lock.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}::text, 0))`;
}
