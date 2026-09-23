import { PrismaClient } from '@prisma/client';

/**
 * Operational revocation of admin sessions.
 *
 * Admin session cookies are signed and stateless (src/lib/auth/session.ts),
 * so there is no session row to delete. Instead each admin carries a
 * `sessionVersion` that every issued token records; incrementing it makes
 * every token that admin holds fail on its next authenticated request
 * (src/lib/auth/revocation.ts). This script is the operator's lever for that
 * — use it after a password change, a lost laptop, or any suspected cookie
 * leak.
 *
 *   npm run admin:revoke-sessions -- --email admin@example.kz
 *   npm run admin:revoke-sessions -- --all
 *
 * It touches only User.sessionVersion. It never reads or writes password
 * hashes, roles, orders, prices or any customer data, and it prints no
 * secret. Running it twice is harmless: the second run simply bumps the
 * version again.
 */

const prisma = new PrismaClient();

function parseArgs(argv: string[]): { email?: string; all: boolean } {
  const all = argv.includes('--all');
  const index = argv.indexOf('--email');
  const email = index >= 0 ? argv[index + 1] : undefined;
  return { email, all };
}

async function main() {
  const { email, all } = parseArgs(process.argv.slice(2));

  if (all === Boolean(email)) {
    console.error('Usage: npm run admin:revoke-sessions -- --email <address>');
    console.error('       npm run admin:revoke-sessions -- --all');
    process.exitCode = 1;
    return;
  }

  const users = all
    ? await prisma.user.findMany({ select: { id: true, email: true } })
    : await prisma.user.findMany({ where: { email }, select: { id: true, email: true } });

  if (users.length === 0) {
    console.error(email ? `No admin user with email ${email}.` : 'No admin users found.');
    process.exitCode = 1;
    return;
  }

  for (const user of users) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
    console.info(`Revoked sessions for ${user.email} — sessionVersion is now ${updated.sessionVersion}.`);
  }

  console.info('Existing cookies for these admins stop working on their next request. They must sign in again.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
