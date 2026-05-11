---
'@hyperdx/api': patch
'@hyperdx/common-utils': patch
---

External Dashboards API: fix `PUT` round-trip when the request body omits
`containers`, and self-heal orphan `containerId` / `tabId` references on
read.

- Move tile-level container/tab reference resolution out of the request
  body schema and into the `POST` and `PUT` handlers, so a `PUT` whose
  body omits `containers` validates tile refs against the existing
  dashboard's containers (the documented "preserve on omit" branch)
  rather than against an empty fallback. Without this, a `PUT` that
  changes only `tiles` while keeping a tile homed in a real preserved
  container was rejected with `Tile references unknown containerId`.
- Split the shared validation helper into a structure-only pass
  (`validateDashboardContainersStructure`) and a tile-ref pass
  (`validateDashboardTileContainerRefs`) on
  `@hyperdx/common-utils`. The composite
  `validateDashboardContainersConsistency` now wraps both, so existing
  callers keep their current behavior.
- On read, drop `tile.containerId` / `tile.tabId` when the ref does not
  resolve to a container (or tab) in the same dashboard. A pre-existing
  doc with an orphan ref now round-trips on `GET` as if the ref were
  absent, so the next `PUT` validates instead of failing with
  `Tile references unknown containerId`. Each drop is logged with the
  dashboard id, tile id, and the offending ref.
- Document in the OpenAPI `PUT /api/v2/dashboards/{id}` description that
  the endpoint does not support optimistic concurrency. Concurrent PUTs
  may silently overwrite each other; clients should serialize edits to
  a given dashboard.
