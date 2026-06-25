---
"@hyperdx/common-utils": patch
"@hyperdx/cli": patch
---

Import ClickHouse client types from the platform packages
(`@clickhouse/client` / `@clickhouse/client-web`) instead of the deprecated
`@clickhouse/client-common`. This makes the packages forward-compatible with
`@clickhouse/client*` 1.23 (where `client-common` is deprecated and each
platform package bundles and re-exports its own copy of the shared types)
without bumping the pinned version. No runtime behavior changes.
