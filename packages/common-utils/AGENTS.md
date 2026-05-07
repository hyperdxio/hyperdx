# common-utils — Berg Agent Guide

Shared TypeScript: query parsing, validation, and Trino SQL emission.
Consumed by both `packages/api` and `packages/app` (the latter via the
prebuilt `dist/`).

## What lives here

- `src/core/renderChartConfig.ts` — emits Trino SQL for chart configs
  (the Berg-side fork of CH's `renderChartConfig`).
- `src/core/metadata.ts` — column/key/value distribution lookups.
  Athena/Trino-flavoured (`tcFromSource`, `getKeyValues`,
  `getValuesDistribution`).
- `src/athena/typeMapping.ts` — Athena→JS type coercion (timestamp
  normalisation, array literal parsing).
- `src/core/utils.ts` — tokenisers, `chSqlToAliasMap`,
  `aliasMapToWithClauses` (CH-era; see gotcha below).
- `src/types.ts` — Zod schemas for ChartConfig / Source / TableMetadata.

## Trino dialect rules (load-bearing)

These are not stylistic — getting them wrong produces SYNTAX_ERROR or
silently-wrong queries. Each was a bug we hit and paid for.

1. **`WITH` is CTE-only.** Trino does not allow per-expression alias
   binding (`WITH alias AS (expression)` — that's CH). `WITH` may only
   contain named subqueries: `WITH name AS (SELECT …)`. Never feed
   `aliasMapToWithClauses(...)` output through `renderWith` — its
   `{isSubquery: false}` shape emits CH form.

2. **`json_format(json)` not `cast(json AS varchar)`.** The cast only
   works on scalar JSON values (string/number/bool/null) and raises
   `INVALID_CAST_ARGUMENT` on objects/arrays. `json_format` is the
   universal JSON→varchar.

3. **`json_extract` returns json (unorderable).** Use
   `json_extract_scalar` whenever the result lands in `ORDER BY`,
   `GROUP BY`, or a comparison. Sorting on `json` raises
   `TYPE_MISMATCH: Type json is not orderable`.

4. **Athena names unaliased SELECT columns `_col0`, `_col1`, …** Those
   labels exist only on the result set — referencing them in
   `ORDER BY` / `WHERE` against the underlying table fails with
   `COLUMN_NOT_FOUND`. Resolve by ordinal back to the original SELECT
   expression before emitting the clause.

5. **`OFFSET` precedes `LIMIT`.** Trino requires `OFFSET m LIMIT n`,
   not CH's `LIMIT n OFFSET m`. `renderLimit` already handles this —
   don't hand-roll.

6. **Time-bucket `AS` in `GROUP BY` / `ORDER BY` is illegal.** Trino
   rejects `GROUP BY date_trunc(...) AS bucket`. Drop the alias in
   group/order positions; keep it in the SELECT list only.

7. **No `groupUniqArray`, `cityHash64`, `parseDateTime64BestEffort`,
   `toJSONString`, `LowCardinality`, etc.** These are CH-only. Trino
   substitutes:
   - `groupUniqArray(col)` → `slice(array_agg(DISTINCT col), 1, N)`
   - timestamp parsing → `cast(? as timestamp)` over space-separated
     `YYYY-MM-DD HH:mm:ss[.fff]` (no `Z`, no `T`).

## Conventions

- All SQL emitters return `{sql, params}` — never raw strings. The
  `params` map is filled by the API-side query controller before
  shipping to Athena.
- `renderChartConfig` is async because nested chart configs (CTEs)
  recurse through it. Don't make it sync.
- `Source` is the user-facing connection record (Mongo). Always derive
  `connectionId` from `source.id` when calling metadata helpers; never
  from `source.connection`.

## Tests

```bash
yarn ci:unit                 # unit
yarn ci:unit __tests__/renderChartConfig.test.ts
```

(There are no integration tests in this package today — the CH-era
`*.int.test.ts` files were removed during the Trino port.  When new
ones land they should mock Athena via `aws-sdk-client-mock`, not hit a
live cluster.)

Snapshots in `__tests__/__snapshots__/renderChartConfig.test.ts.snap`
are the canonical record of emitted SQL — read them when in doubt
about what a config produces.

## Don'ts

- Don't import from `dist/` inside this package — use `src/`. Only
  consumers reach in via `dist/`.
- Don't add CH-only fallbacks "just in case." Berg is Trino-only;
  dead branches accumulate fast.
- Don't widen `ChartConfig` schema casually — every consumer revalidates
  with `ChartConfigSchema.safeParse`.
