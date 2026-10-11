---
name: quality
description: Run the canonical MSConstructor full quality gate when the user requests full validation, the quality workflow, or a pre-commit quality check.
---

# MSConstructor quality gate

This workflow mirrors the repository's existing canonical quality process and
the commands used by CI. Run these commands sequentially from the repository
root:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test`
4. `npm run build`
5. `npm run test:e2e`

Stop on the first real failure and report the exact failing command plus the
relevant error. Do not continue to later steps after a failure.

Do not edit code automatically, run fixers, weaken or delete tests, skip steps,
hide failures, or add retries merely to make the workflow green. Do not commit
or push. If the user separately asks to fix a failure, treat that as a new
implementation task and rerun the gate from the beginning after the fix.

If all five commands pass, report a concise PASS summary. Follow `AGENTS.md`.
