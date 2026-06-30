---
"@hyperdx/common-utils": patch
"@hyperdx/cli": patch
---

Bump `@clickhouse/client*` to `1.23.0-head.fae5998.1` and fix the type
incompatibility it introduces.

In `@clickhouse/client*` 1.23 each platform package (`@clickhouse/client`,
`@clickhouse/client-web`) bundles its own copy of the shared types, so their
`ClickHouseSettings` types — which reference the nominally-compared `SettingsMap`
class — are no longer the same type as `@clickhouse/client-common`'s. The shared
`processClickhouseSettings()` helper produces the `client-common` flavor, so
assigning it into the per-platform clients' `query()` now requires an explicit
bridge. Guard the existing `as ClickHouseSettings` assertions at those
boundaries (`node.ts`, `browser.ts`, `cli`) with a scoped
`@typescript-eslint/no-unsafe-type-assertion` disable, matching the existing
"client library type mismatch" pattern. No runtime behavior changes.
