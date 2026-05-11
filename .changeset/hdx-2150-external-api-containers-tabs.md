---
'@hyperdx/api': minor
---

External Dashboards API now round-trips the new dashboard organization
layer added in #2015: `containers` on the dashboard, optional `tabs` on each
container, and `containerId` / `tabId` on each tile. Create, get, list, and
update all preserve the structure. The body validates that tile
`containerId` references resolve to a real container, that tile `tabId`
references resolve to a tab inside that container, and that tab ids are
unique within a container. Container id uniqueness is already enforced by
the shared schema. Dashboards saved without `containers` round-trip
unchanged.
