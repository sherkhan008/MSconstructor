# CLAUDE.md — Project Rules

These rules are permanent project invariants.
Read this file before making changes.
If a task conflicts with these rules, do not silently reinterpret it. Stop and explain the conflict.

## 0. Instruction priority

Follow requirements in this order:

1. Latest explicit user instruction.
2. This `CLAUDE.md`.
3. Current task specification.
4. Reference screenshots and examples.
   Never invent a compromise between conflicting requirements.
   If an important requirement is ambiguous, ask instead of guessing.
   Words such as `remove`, `white`, `hidden`, `only`, `never`, and `every` are literal.

## 1. Scope and existing implementation

* Change only what the current task requires.
* Do not refactor unrelated files.
* Do not redesign architecture unless explicitly requested.
* Prefer the smallest safe change that fully satisfies the task.
  Before editing:
* inspect the relevant existing files;
* identify the current source of truth;
* identify what currently produces the behavior;
* reuse existing helpers, actions, components, and data where possible.
  Do not create a second implementation of existing functionality.
  Do not add new colors, gradients, shadows, animations, cards, panels, icons, or explanatory text unless required.

## 2. Architecture invariants

Unless explicitly requested, do not significantly change:

* `src/lib/pricing/*`;
* BOM calculation;
* formula engine;
* compatibility rules;
* configuration domain model;
* cart schema;
* order schema;
* URL serialization;
* persisted Zustand migration.
  The current section-based configuration model is authoritative.
  Do not return to a single shared section-width model.
  Do not move business logic into React components.

## 3. Sources of truth

* Configuration state: existing configurator store.
* Product dimensions/compatibility: product/catalog data.
* Pricing: server pricing engine.
* BOM quantities: BOM logic.
  React components render these values; they do not recreate their business rules.
  Never invent unsupported widths, heights, depths, loads, SKUs, accessories, or compatibility combinations.
  If a reference image shows unsupported product data, do not add it automatically.

## 4. Pricing and commercial data

* Final price must be calculated or validated on the server.
* Never trust totals received from the browser.
* Never accept client-supplied markup, discount, VAT, BOM quantities, or final totals without server validation.
* Do not duplicate pricing formulas in client UI.
* Visual/drag state must never create a fake final price.
  Customer-facing UI must never expose:
* purchase cost;
* supplier price;
* supplier name unless intentionally public;
* markup / `Наценка`;
* margin or minimum margin;
* internal pricing formulas.
  Do not show a separate VAT / `НДС` row in the customer configurator.
  VAT may remain in internal server-side calculation.
  If pricing fails, do not present an old total as current.
  Disable checkout/add-to-cart until a valid current server price exists.

## 5. Configurator UX

This is a customer-facing sales configurator, not an engineering admin interface.
A non-technical customer should understand the main workflow without instructions.
Prioritize:

1. product visualization;
2. dimensions and sections;
3. final price;
4. purchase/order actions;
5. secondary settings.
   Prefer simplicity over extra information.
   Do not let secondary controls dominate.
   Avoid duplicate controls for the same setting.

## 6. Configurator visual rules

Front View and Top View must use pure white `#FFFFFF`.
Never render:

* blueprint grid;
* blue graph-paper lines;
* blue grid squares;
* decorative engineering-paper texture.
  Empty space between shelves must remain white.
  Do not render decorative filled panels between shelves.
  Rear structural vertical posts must remain visible in Front View.
  A rear structural post is not the same as `rearWall`.
  When `rearWall === false`, render no rear panel but keep rear uprights visible.
  Render `rearWall`, `leftWall`, and `rightWall` only when enabled.
  Do not add fake walls for styling.
  Preferred SVG layer order:

1. white background;
2. rear structural elements;
3. selected rear/side walls;
4. shelf depth surfaces;
5. shelf front edges;
6. front structural posts;
7. dimension markers;
8. interaction controls;
9. resize handles.
   Decorative fills must never hide structural uprights.

## 7. Resize and preview behavior

Do not rewrite the existing resize system unless explicitly requested.
During drag:

* update temporary visual state smoothly;
* do not call pricing API on every pointer move;
* do not snap continuously.
  On release:
* snap to nearest supported compatible dimension;
* commit configuration;
* recalculate server price once.
  Width drag applies to the relevant section.
  Height and depth remain global unless intentionally changed later.
  `Вид спереди` and `Вид сверху` are presentation modes.
  Changing preview mode must not change configuration, price, BOM, cart, or trigger pricing.
  Preview mode should remain UI state unless explicitly required otherwise.

## 8. No fake UI or hardcoding

Do not implement static mockups for dynamic configurator functionality.
Visuals must reflect real current configuration state.
Do not hardcode section count, widths, shelf count, dimensions, price, or wall state.
Reference screenshots are visual references only, not data sources.
If a UI control changes configuration, connect it to existing real state/actions.

## 9. Mobile and accessibility

Every customer-facing UI change must remain usable on mobile.
Do not simply shrink wide desktop layouts onto small screens.
Avoid unintended full-page horizontal scrolling.
Important touch targets should be about `44×44 CSS px` or larger.
Primary functionality must not require a mouse.
Where applicable preserve keyboard access, focus states, labels, accessible errors, and non-drag alternatives.
Do not remove working accessibility during visual refactors.

## 10. Performance and dependencies

Avoid unnecessary rerenders and network calls.
Do not trigger pricing requests for every drag pixel, preview-mode switching, or purely visual hover/select state.
Do not introduce expensive animation without a functional reason.
Do not add or upgrade packages unless genuinely required.
Before adding a package, check whether the existing stack already solves the problem.
Do not perform broad dependency upgrades during unrelated tasks.

## 11. Security

Never expose secrets or private environment variables to client components.
Never commit `.env`, `.env.local`, API secrets, database credentials, or private keys.
Validate public API input server-side.
Do not trust hidden UI state or client authorization as a security control.
Do not use `eval`, `new Function`, or unsafe HTML execution for business logic.

## 12. Git and generated files

Do not manually edit generated/build output unless explicitly required.
Examples: `.next`, `node_modules`, Playwright reports, test result folders, generated caches.
Do not commit, push, force-push, reset, rebase, or delete branches unless explicitly requested.
Do not discard existing uncommitted work.
Before destructive Git operations, explain what will happen.

## 13. Tests and visual verification

After meaningful code changes, run relevant checks.
For a full configurator change:

```bash
npm run lint
npx tsc --noEmit
npm run test
npm run build
npx playwright test
```

Do not weaken or delete valid tests merely to make them pass.
If UI selectors changed, update selectors while preserving behavioral coverage.
Passing tests does not mean a UI task is visually complete.
For meaningful UI changes:

* run the application;
* inspect `/configurator`;
* inspect representative desktop and mobile sizes;
* compare the rendered result with the user's requirements/reference;
* fix obvious mismatches before reporting completion.
  If the requested visual result is not achieved, the task is not complete.

## 14. Completion rules

If the user asks to implement, modify, fix, create, or remove something, perform the implementation.
Do not stop after producing a plan unless planning was explicitly requested or permissions prevent editing.
A plan is not completion.
Before declaring completion, confirm:

* requested functionality works;
* unrelated functionality did not regress;
* no internal commercial data leaked;
* no console-breaking errors exist;
* relevant tests/build pass;
* visual acceptance criteria were manually checked.
  Report limitations truthfully instead of silently approximating them.

## 15. Agent tooling, data and production boundaries

Normal agent work is local repository work. Enforcement lives in
`.claude/settings.json` (`permissions.deny` / `ask`) and local hookify rules
(`.claude/hookify.*.local.md`), but these rules apply even where enforcement
cannot see a command.

Database:

* The database in `.env` holds real business data (imported supplier prices, orders). It is never disposable.
* Never run `prisma migrate reset`, `npm run db:reset`, `prisma db push`, `DROP DATABASE`, `DROP SCHEMA`, `TRUNCATE`, destructive seed/reset scripts, `docker compose down -v`, or `docker volume rm` / `prune`.
* Only disposable test databases created by the test tooling itself (the CI service database, an explicitly exported test `DATABASE_URL`) may be reset, and only by that tooling.
* `prisma migrate deploy`, `npm run db:*` and `prisma:seed` write data: run them only when the task asks, after saying what will change. Never edit existing migrations.

Git history:

* Never delete, move or rewrite `backup/pre-history-rewrite-20261001`, `refs/codex/turn-diffs/*` or reflogs.
* Never run `git reflog expire`, `git gc`, `git prune`, `git update-ref`, `filter-branch` / `filter-repo`, or force-push until the owner confirms GitHub Support has purged the old unreachable commits.

Secrets:

* Never print, copy or summarize `.env`, `.env.production`, `AUTH_SECRET`, database passwords, WhatsApp/Telegram credentials, `SELLER_*` bank details, SSH keys or tokens. Report variable names only.
* Never add secrets to Git, test snapshots, fixtures, logs or CI output. Use synthetic values (for example `tests/fixtures/seller-banking-sentinels.ts`).

Production:

* Never SSH to the VPS, deploy, run `scripts/ops/*`, change DNS or certificates, restart, migrate, seed or edit production env, or touch live PostgreSQL/Redis without an explicit owner instruction in a dedicated task.

Network:

* Outbound access is for the npm registry, GitHub, official documentation and Playwright browser downloads. Never upload repository content, data or secrets to arbitrary endpoints, and never pipe downloaded code into a shell.

Commercial data: run the `pricing-leak-reviewer` agent before committing changes that touch pricing, catalog, BOM, orders, documents, public pages, API routes, logging or fixtures. `/quality` remains the canonical quality workflow.
