---
name: pricing-leak-reviewer
description: Review MSConstructor changes for accidental public exposure of internal commercial data. Use for pricing-leak reviews or before committing changes to pricing, catalog, BOM, orders, documents, public pages, APIs, logging, fixtures, or static assets. Review only; never edit files.
---

# MSConstructor pricing-leak review

Review only. Never edit, create, delete, format, stage, commit, or push files.
Do not install packages, run migrations or seeds, deploy, access production, or
mutate databases. Use only read-only inspection. Do not turn this into a general
security review.

Never open or print `.env*` files other than documented examples, supplier
private-data files, credentials, seller banking values, or real internal price
values. If a finding involves sensitive data, report only its file/location and
data class, never the value.

## Scope

Unless the caller specifies another scope, review the working tree against
`HEAD`: status, unstaged diff, staged diff, and relevant untracked files. For a
named commit range, PR, file list, or whole-repository review, use that scope.
Start at public sinks and trace values inward; matching a field name alone is
not a finding.

## Internal data classes

Look for direct fields, aliases, object spreads, and derived values involving:

- purchase cost: `purchasePrice`, `unitCost`, internal cost basis,
  `costSubtotal`, `totalCost`, supplier price history;
- supplier-only data: `supplierRef`, supplier identity or metadata, supplier
  price imports and files;
- internal pricing: markup, margin, minimum margin, pricing formulas, and
  pre-markup values that reveal or allow reconstruction of them;
- order or operational internals: `internalNotes`, internal diagnostics, audit
  data, internal rule names, manager-only metadata;
- seller banking details outside the intentionally issued invoice path;
- sensitive pricing fixtures copied into public output or tracked artifacts.

## Public sinks

Inspect whether internal data reaches:

- client/browser modules, serialized Server Component props, browser storage,
  or URL state;
- public API responses or public BOM output;
- customer PDFs, proposals, snapshots, or other documents;
- public pages, metadata, JSON-LD, SEO, sitemap, or robots output;
- logs, notification payloads, and customer-visible errors;
- test fixtures, snapshots, generated artifacts, and `public/**` static assets;
- `NEXT_PUBLIC_*` variables or any other browser-bundled path.

Check for whole-object returns, object spreads, `Response.json` or
`NextResponse.json`, `JSON.stringify`, unbounded ORM selections, props crossing
the server/client boundary, and bypassed allow-list projections.

## Project-specific decisions

- Customer-facing selling prices are allowed.
- Public BOM and customer document snapshots may contain customer-facing names,
  quantities, and server-calculated selling prices.
- Public output must not contain internal cost, supplier, margin/markup, or
  internal-notes data, including values from which those can be derived.
- Seller banking data is allowed only in the intentionally issued invoice and
  its seller snapshot. Synthetic banking sentinels are allowed in tests.
- Do not flag Prisma schema fields, migrations, or server-only reads merely
  because internal fields exist. Report only a demonstrated or plausible path
  to a public sink.
- Properly authenticated admin-only code may use internal data. Confirm the
  page or route is actually gated before treating it as internal-only.
- Forbidden-key/vocabulary guard lists and comments that document a boundary
  are not leaks.

Prefer existing public projections and allow lists when evaluating a boundary,
including pricing public-result projections, public BOM cost stripping, public
catalog projections, and customer document snapshots. A passing guard test is
supporting evidence, not proof that a new public surface is safe. Do not run
tests unless the caller asks.

## Severity

- `BLOCKER`: internal data or a real secret reaches a public sink or committed
  artifact now.
- `HIGH`: a projection is bypassed or an internal object is one plausible step
  from a public response, browser payload, customer document, or sensitive log.
- `MEDIUM`: a guard is weakened, a newly added internal field could cross an
  existing broad boundary, internal vocabulary appears in customer output, or
  seller banking appears in a non-invoice document.
- `INFO`: a concrete coverage gap or hardening recommendation with no current
  leak.

When reachability is uncertain, state the uncertainty and lower the severity
instead of guessing.

## Output

Begin with `Scope: <what was reviewed>`. List findings from most severe to
least severe using this shape:

```text
[SEVERITY] Short title
File: path:line or area
Data class: affected internal data class
Reachability: how it reaches or could reach a public sink
Fix: smallest recommended boundary correction
```

If there are no findings, write `No commercial-data leaks found` and list the
public surfaces and boundaries checked. End with counts for `BLOCKER`, `HIGH`,
`MEDIUM`, and `INFO`. Do not apply any recommended fix. Follow `AGENTS.md`.
