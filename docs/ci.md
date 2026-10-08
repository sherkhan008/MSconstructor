# Continuous integration

`.github/workflows/ci.yml` runs on every pull request to `main` and every push
to `main`. It is a quality gate only — it never deploys and needs no
repository secrets. The `/quality` skill stays the developer-facing way to run
the same gate locally; CI cannot run a Claude skill, so it runs the underlying
npm commands directly.

## Jobs

| Check (job name) | What it proves |
| --- | --- |
| `Static checks & unit tests` | `git diff --check` on the pushed / PR range, CI Node major = `Dockerfile` base image, `npm run lint`, `npm run typecheck`, `npm run test` (whole Vitest suite, no external infrastructure) |
| `Integration tests (PostgreSQL + Redis)` | `prisma migrate deploy` + seed on a disposable PostgreSQL 16, then every Vitest suite gated on `DATABASE_URL` / `RATE_LIMIT_TEST_REDIS_URL`, against it and a disposable Redis 7 — and fails if any of them skipped |
| `Production build` | `npm run build` from a clean `npm ci`, and that nothing tracked was modified by install/generate/build |
| `E2E (Playwright)` | the full Playwright suite (desktop + mobile Chromium) against the `Production build` output served by `next start`, with a migrated and seeded disposable PostgreSQL so the admin specs run |

`E2E (Playwright)` waits for `Production build`; the other jobs run in
parallel. Every job installs through `.github/actions/setup-project` (Node 22,
`npm ci`, `npm run prisma:generate`, and a check that the generated client
matches `prisma/schema.prisma`) — keep Prisma generation there.

## Branch protection

Once the workflow has run green on `main`, mark all four checks as required:

- `Static checks & unit tests`
- `Integration tests (PostgreSQL + Redis)`
- `Production build`
- `E2E (Playwright)`

Renaming a job renames its check — update the branch protection rule in the
same change.

## Determinism rules

- E2E runs with `retries: 0` and 2 workers in CI (`playwright.config.ts`).
  A test that needs a retry is a bug to fix, not a pass. The HTML report and
  the traces of failed tests are uploaded as the `playwright-report`
  artifact when the job fails.
- Expected skips: the Vitest run in `Static checks & unit tests` skips exactly
  the real-infrastructure blocks that `Integration tests` runs (0 skipped
  there). Playwright skips only the tests that are desktop- or phone-only by
  design in the other project — never for missing infrastructure.
- All credentials in the workflow are synthetic and exist only for the
  run's service containers.

## Reproducing a job locally

```bash
# Static checks & unit tests
npm run lint && npm run typecheck && npm run test

# Integration tests — against a disposable database, never the dev one
docker run -d --name ci-pg -p 127.0.0.1:55432:5432 -e POSTGRES_USER=ci \
  -e POSTGRES_PASSWORD=ci -e POSTGRES_DB=ms_shelving_ci postgres:16-alpine
docker run -d --name ci-redis -p 127.0.0.1:56379:6379 redis:7-alpine
export DATABASE_URL=postgresql://ci:ci@127.0.0.1:55432/ms_shelving_ci?schema=public
export DIRECT_URL=$DATABASE_URL RATE_LIMIT_TEST_REDIS_URL=redis://127.0.0.1:56379
npm run prisma:deploy && npm run prisma:seed
# the same discovery the workflow uses
npx vitest run $(grep -rlE 'skipIf\(' tests/unit tests/integration \
  | xargs grep -lE 'process\.env\.(DATABASE_URL|RATE_LIMIT_TEST_REDIS_URL)')

# Production build + E2E
npm run build && npm run test:e2e
```
