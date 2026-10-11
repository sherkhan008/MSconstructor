# AGENTS.md — Codex Project Guidance

This is the Codex entrypoint for MSConstructor. Read it before making changes.
If a task conflicts with these rules, stop and explain the conflict.

## Shared project rules

`CLAUDE.md` remains the detailed source for the repository's product,
architecture, pricing, configurator, accessibility, testing, and completion
invariants. Codex must read and follow sections 0–14 before changing the
repository. Do not copy those rules into another Codex file or reinterpret
Claude-specific files such as `.claude/settings.json`, hooks, agents, or skills
as Codex configuration.

Prefer the smallest safe change. Do not modify product/application code unless
the task requires it, and do not discard uncommitted work.

## Codex workflows

- Use `.agents/skills/quality/SKILL.md` for the canonical full quality gate.
- Use `.agents/skills/pricing-leak-reviewer/SKILL.md` for review-only checks of
  public commercial-data boundaries.
- Do not run the full quality gate when only instructions or tooling metadata
  changed; validate the changed configuration instead.
- Do not automatically run Semgrep, Strix, broad security scans, deployments,
  migrations, seeds, or production operations.

## Destructive-operation boundary

Never execute the following automatically. They require a separate, explicit
owner instruction with an exact target and a safe recovery plan; production
actions also require a dedicated production task:

- `git reset --hard`, `git clean`, force-push, history rewrite,
  `git filter-repo`, `git filter-branch`, `git update-ref`, reflog expiry,
  `git gc`/`git prune` for history cleanup, or destructive branch/ref deletion;
- `prisma migrate reset`, or `prisma db push` against a non-disposable database;
- `DROP DATABASE`, `DROP SCHEMA`, or `TRUNCATE` against real data;
- `docker compose down -v`, `docker volume prune`/`rm`, or
  `docker system prune`;
- recursive destructive deletes;
- SSH/SCP/SFTP to production, production operations scripts, `certbot`,
  production deployment, or live database changes.

Do not touch `backup/pre-history-rewrite-20261001`,
`refs/codex/turn-diffs/*`, or pre-rewrite reflogs until the owner confirms that
the GitHub Support purge is verified.

Do not commit, push, rewrite history, delete branches, or stage files unless the
owner explicitly asks.

## Secrets and commercial data

Never print, expose, summarize, or copy into tracked files:

- `.env` or `.env.production` contents;
- `AUTH_SECRET` or database passwords;
- WhatsApp or Telegram credentials;
- seller banking details;
- SSH private keys;
- GitHub tokens;
- browser or session credentials.

Synthetic test credentials and clearly synthetic banking sentinels are allowed.
Report secret variable names and locations without revealing values. Never put
secrets in source, fixtures, snapshots, logs, generated artifacts, or chat.

Customer-facing selling prices are allowed. Public output must not expose
purchase cost, supplier-only data, internal margin/markup, internal notes, or
other internal pricing inputs. Seller banking data is allowed only in an
intentionally issued invoice path.

## Production boundary

Normal Codex work is repository-local. Unless the owner explicitly requests a
dedicated production task, do not:

- SSH to a VPS or use SCP/SFTP;
- change DNS or request certificates;
- restart or deploy production services;
- run production migrations or seeds;
- edit production environment configuration;
- access live PostgreSQL or Redis.

## Tools and integrations

Use GitHub write operations only when explicitly requested. Prefer repository
tools, Playwright, and read-only official documentation/context tools. Do not
add by default a database-writing Prisma MCP, broad commit/push helpers,
always-on Semgrep guardians, unknown remote MCPs, or tools with unrestricted
filesystem or network access. Do not modify user-global Codex or Claude
configuration unless the owner explicitly asks.
