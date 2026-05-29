---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

feat(dashboards): support constant values and render modes for dashboard filters

Dashboard filters can now be locked to the dashboard's saved default value
(`constant: true`) so viewers cannot change the scope, and the filter chip
can be hidden from the filter bar or rendered as a disabled chip
(`renderMode: 'readonly' | 'hidden'`). One dashboard template can be cloned
and re-pointed by saving a different default per copy, instead of
hand-coding the scope into every tile's WHERE clause. The filter editor
exposes a single "Visibility" select with three presets (Editable, Read-only,
Hidden); the external API and MCP `hyperdx_save_dashboard` tool accept the
two new fields and preserve them across round-trips.
