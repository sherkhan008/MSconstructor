import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * The one environment every Vitest file starts from: the shell's own
 * environment, never the developer's untracked `.env`.
 *
 * Why this exists: Prisma's generated client loads `<project root>/.env`
 * into `process.env` (dotenv, filling every variable that is not already
 * set) when `@prisma/client` is first required AND again inside every
 * `new PrismaClient()`. A test that merely imports `Prisma` from
 * `@prisma/client`, or imports a module that builds the client, therefore
 * silently picked up whatever that `.env` held — DATABASE_URL, AUTH_SECRET,
 * seller details and, decisively, TRUSTED_PROXY_CLIENT_IP_HEADER. With that
 * header present the client-IP resolver (src/lib/security/client-ip.ts)
 * leaves the documented test mode and trusts X-Real-IP instead, so the same
 * commit passed in a clean checkout and failed on a developer machine. A
 * PrismaClient built after a test had deleted a variable even put the
 * `.env` value back mid-test.
 *
 * Prisma 6 has no switch to turn that loading off. Its loader only reads a
 * file that `fs.existsSync` reports as present, so within the test process
 * the project-root `.env` — that one exact path, nothing else — is reported
 * as absent. The check below fails the run loudly if a Prisma upgrade ever
 * loads `.env` some other way, instead of letting the leak return silently.
 *
 * Production is unaffected: this file is only ever loaded by Vitest
 * (vitest.config.ts `setupFiles`), and the production image never contains
 * a `.env` (.dockerignore).
 *
 * Opt-in suites that need real infrastructure keep working exactly as
 * documented — export the variable in the shell for that run, e.g.
 * DATABASE_URL for the real-PostgreSQL suites or RATE_LIMIT_TEST_REDIS_URL
 * for the real-Redis ones.
 */

const projectDotenv = path.resolve(__dirname, '..', '..', '.env');

const isProjectDotenv = (candidate: fs.PathLike): boolean => {
  if (typeof candidate !== 'string') return false;
  // path.relative compares case-insensitively on Windows.
  return path.relative(projectDotenv, path.resolve(candidate)) === '';
};

const existsSync = fs.existsSync;
fs.existsSync = (candidate: fs.PathLike) => (isProjectDotenv(candidate) ? false : existsSync(candidate));

/**
 * Deployment-only switches that change trust or storage semantics. A test
 * that needs one stubs it itself (vi.stubEnv); none may inherit it from
 * whatever shell the suite happens to be started in.
 */
const DEPLOYMENT_ONLY_VARIABLES = ['TRUSTED_PROXY_CLIENT_IP_HEADER', 'REDIS_URL'] as const;
for (const name of DEPLOYMENT_ONLY_VARIABLES) delete process.env[name];

const before = new Set(Object.keys(process.env));
createRequire(__filename)('@prisma/client');
const injected = Object.keys(process.env).filter((name) => !before.has(name));
if (injected.length > 0) {
  // Names only — never values.
  throw new Error(
    `tests/setup/test-environment.ts: loading @prisma/client added ${injected.join(', ')} to process.env. ` +
      'Prisma read the project .env despite the guard; the test environment would no longer be deterministic.',
  );
}
