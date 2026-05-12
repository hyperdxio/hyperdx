---
'@hyperdx/api': patch
'@hyperdx/common-utils': patch
---

Internal refactor: move `validateDashboardContainersStructure` and
`validateDashboardTileContainerRefs` (and their two helper types) out
of `@hyperdx/common-utils/dist/types` into a new
`@hyperdx/common-utils/dist/dashboardValidation` module. The `types`
file now only contains types and type guards, matching the rest of the
codebase. The previously exported `validateDashboardContainersConsistency`
composite was only used by its own unit test and is dropped; production
code in the v2 dashboards router uses the two underlying helpers
directly. No behaviour change for callers of the external API.
