---
'@hyperdx/app': minor
---

Overlay deployment markers on dashboard tile charts, derived from changes in the
OpenTelemetry `service.version` resource attribute. Markers are scoped to the
data each tile is charting and tinted to match their service's series color, and
are suppressed on charts where they can't be tied to a visible line — so an
aggregate line spanning many services isn't annotated with releases you can't
attribute to it.
