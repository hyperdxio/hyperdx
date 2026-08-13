---
'@hyperdx/common-utils': minor
---

Add the metric formula expression model: a `formulas` entry on chart configs (letter-based series refs — `A`, `B`, `C` map to `select` positions) plus an arithmetic-only parser/validator (`core/formula.ts`) that produces a validated AST and structured validation errors (unknown series ref, empty expression, malformed syntax, invalid tokens). Groundwork for metric formulas like `A / (A + B + C) * 100`; no query rendering or UI changes yet.
