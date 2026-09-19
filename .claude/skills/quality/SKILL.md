---
name: MSconstructor Quality Check
description: Run the full MSconstructor quality gate: lint, typecheck, unit tests, production build, and Playwright E2E tests. Use only when explicitly invoked.
disable-model-invocation: true
---

Run the MSconstructor quality checks in this exact order:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test`
4. `npm run build`
5. `npm run test:e2e`

Rules:

- Stop immediately when any step fails.
- Do not weaken, skip, delete, or modify tests just to make them pass.
- Do not change source code unless the user explicitly asks you to fix failures.
- Report the exact failing command and the relevant error.
- If every step passes, report a concise PASS summary.
- Respect all rules in CLAUDE.md.
