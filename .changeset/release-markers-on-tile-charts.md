---
'@hyperdx/app': minor
---

Overlay release markers on dashboard tile charts, showing when each version of a
service first appeared so a deployment can be lined up against a change in the
data. Markers are scoped to the data each tile is charting and tinted to match
their service's series color, and are suppressed on charts where they can't be
tied to a visible line, so an aggregate line spanning many services isn't
annotated with releases you can't attribute to it.
