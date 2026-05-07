# api — Berg Agent Guide

Express backend (Node 22+). MongoDB for metadata; Athena (via the
Trino client) for telemetry queries. Authentication is Passport.js
session-based with team scoping.

## What lives here

- `src/api-app.ts` — Express app wiring (middleware, router mount).
- `src/server.ts` — entry point.
- `src/routers/api/` — internal API consumed by the Next.js app.
  - `sources.ts` — Source CRUD + Glue catalog passthroughs
    (`GET /sources/:id/columns`).
  - `query.ts` — query execution. `case 'unknown'` surfaces Athena
    error messages back to the UI as HTTP 400.
- `src/routers/external-api/` — public API (token-auth).
- `src/controllers/query.ts` — translates `{sql, params}` into the
  Athena/Trino client call. **Always** binds params on the server side;
  never substitutes into the SQL string.
- `src/clickhouse/` (Berg legacy name) — the Athena/Trino client
  wrapper. The directory keeps its CH-era name but every code path
  now talks to Athena.
- `src/models/` — Mongoose schemas. Every read MUST filter by
  `team: teamId` (multi-tenancy invariant).

## Multi-tenancy invariant

Every Mongo query, every Athena query, every external-API call is
scoped to `Team`. Forgetting `team: req.user.team` in a Mongo `find`
is a data-leak bug. Reviewers look for this — assume CI doesn't
catch it.

## Conventions

- Routers stay thin. Validation (Zod) at the router boundary;
  business logic in `controllers/`.
- Errors thrown from controllers must be `HttpError`-shaped so the
  global error middleware emits the right status. Bare `throw` becomes
  a 500.
- The Athena query path returns row data as
  `JSONCompactEachRowWithNamesAndTypes` (a stream synthesised by the
  app-side `clickhouse.ts` shim). The wire format is fixed; if you
  change it, update the parser on both sides.
- `GET /sources/:id/columns?database=X&table=Y` is the Glue catalog
  bridge. The app uses it to side-step the CH `DESCRIBE` call that
  Athena doesn't have.

## Local dev

```bash
make dev-int-build                  # one-time
make dev-int FILE=<test-name>       # spins Docker, runs integration test
```

Integration tests hit a real Trino. Don't mock the database — the CH
era proved that drift between mocks and prod silently masks bugs.

## Don'ts

- Don't add a Mongo query without a `team` filter. Even read-only.
- Don't return raw Athena error strings to anonymous clients —
  sanitise in the router before the 400.
- Don't bypass Passport in new routes. Every internal route goes
  through the auth middleware in `api-app.ts`.
- Don't import from `packages/common-utils/dist` in tests — point at
  `src/` so source maps work.
