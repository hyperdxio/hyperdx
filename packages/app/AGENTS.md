# app — Berg Agent Guide

Next.js 16 frontend. TypeScript, Mantine UI, TanStack Query for
server state, Jotai for client state, URL params for filter state.
Uses prebuilt `@berg/common-utils/dist` (must build common-utils first
when iterating on shared code).

## What lives here

- `src/DBSearchPage.tsx` — the `/search` view. Hosts the histogram
  chart, row table, filter sidebar, and SQL editor. Big file; treat
  with care.
- `src/components/` — table, charts, sidebar, side panel, SQL editor.
- `src/hooks/` — TanStack query wrappers
  (`useChartConfig`, `useExplainQuery`, `useRowWhere`, etc.).
- `src/clickhouse.ts` — *legacy name*. The browser-side client.
  Intercepts `DESCRIBE` calls and rewrites them to the API's Glue
  catalog endpoint (`GET /api/sources/:id/columns`).
- `src/clickhouse-types.ts` — type coercion + the
  `chSqlToAliasMap` SELECT-list parser.
- `pages/` — Next routes (App Router not in use).

## Conventions

- **Mantine first.** Use Mantine components (`Button`, `ActionIcon`,
  `Modal`, etc.) with Berg's custom variants (`primary`, `secondary`,
  `danger`). Don't roll bespoke UI when a Mantine equivalent exists.
- **State boundaries:**
  - URL params for shareable filter state (search, time range, source).
  - Jotai for cross-component client state.
  - TanStack Query for *all* server data — caching, refetch, stale.
  - `useState`/`react-hook-form` for local form state.
- **Component size cap ≈ 300 lines.** Split when you cross. Big files
  are where this codebase regresses.
- **`connection: source.id` everywhere.** The render path expects the
  Source's id as the connection identifier. `connection: ''` silently
  produces COLUMN_NOT_FOUND on every query. Read
  `src/DBSearchPage.tsx`'s `dbSqlRowTableConfig` for the canonical
  shape.

## Row-WHERE / aliasMap pattern

User-typed `SELECT JSON_PARSE(payload) AS parsed_payload, …` produces
an aliased result set whose alias names don't exist on the underlying
table. The row-detail and inline-expand queries use a column map
populated from `chSqlToAliasMap(chSql)` to substitute the original
expression back. See `src/hooks/useRowWhere.tsx` for the rules:

- Skip JSON / Array / Map / Tuple / Dynamic columns from the
  row-WHERE entirely (MD5 hash round-trip is unreliable across
  Trino's `json_format` and JS's `JSON.stringify`).
- Skip `_col\d+` synthetic names (Athena's auto-naming for unaliased
  expressions).
- `aliasWith` always returns `[]` — Trino's WITH is CTE-only;
  per-expression alias binding (the CH pattern) is a SYNTAX_ERROR.

## SQL editor

`src/components/SQLEditor/constants.ts` lists ≈300 Trino built-in
function names for autocomplete. When you find a missing one
(autocomplete shows nothing for a function that demonstrably works
in Athena), add it there — don't fall back to the CH list.

## Tests

```bash
yarn ci:unit                                    # all unit
yarn ci:unit src/hooks/__tests__/useRowWhere.test.tsx
yarn dev:unit                                   # watch mode
```

E2E from repo root: `make dev-e2e FILE=<name>`.

## Don'ts

- Don't import `@berg/common-utils/dist` from tests — point at
  `@berg/common-utils/src` so jest can transform the TS.
- Don't add a chart that emits `WITH` clauses for user aliases.
  Histograms / filter charts query underlying expressions directly.
- Don't display Athena error strings raw. Wrap them so the user
  knows it's a SQL error and how to back out (re-edit the SELECT,
  reset the time range, etc.).
- Don't use `useLocalStorage` for per-row tab selection — collisions
  across tabs / windows. Use per-instance React state.
