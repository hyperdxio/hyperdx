---
'@hyperdx/app': minor
'@hyperdx/api': minor
---

Overlay deployment markers on dashboard tile charts, derived from changes in a
service's version. Defaults to the OpenTelemetry `service.version` resource
attribute, with a new optional `serviceVersionExpression` on log and trace
sources for teams whose release identifier lives elsewhere, such as a container
image tag under GitOps. Markers are scoped to the data each tile is charting and
tinted to match their service's series color, and are suppressed on charts where
they can't be tied to a visible line — so an aggregate line spanning many
services isn't annotated with releases you can't attribute to it.
