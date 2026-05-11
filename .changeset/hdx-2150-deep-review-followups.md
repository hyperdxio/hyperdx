---
'@hyperdx/api': patch
'@hyperdx/common-utils': patch
---

External Dashboards API: tighten validation around container/tab references
on the v2 dashboards routes.

- Cap tile `containerId` and `tabId` at 256 characters to mirror the
  internal `DashboardContainer` schema and the `DASHBOARD_CONTAINER_ID_MAX`
  constant, now exported from `@hyperdx/common-utils`.
- Cap a single dashboard payload at 500 tiles via the new
  `DASHBOARD_MAX_TILES` constant to keep one request from pushing tens of
  MB into Mongo.
- Treat empty-string `containerId` / `tabId` on legacy Mongo docs as
  absent on read, so dashboards predating the containers feature still
  round-trip through the external schema's `min(1)` cap.
- Extract the cross-tile container/tab consistency check into a shared
  `validateDashboardContainersConsistency` helper so the canonical
  schema and the request body schema agree on what a valid payload is.
- OpenAPI now publishes the matching `maxLength` and `maxItems` bounds
  on `DashboardContainer.id`, `DashboardContainerTab.id`, the
  `containers` array, and the request `tiles` array.
