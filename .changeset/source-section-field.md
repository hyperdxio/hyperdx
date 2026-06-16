---
"@hyperdx/common-utils": patch
"@hyperdx/api": patch
"@hyperdx/app": patch
---

feat: add an optional Section field to data sources

Sources can now carry an optional free-text Section label, set from the source
settings form. The value is persisted and returned by GET /api/v2/sources, so
external API consumers can read it. This lays the groundwork for grouping and
searching sources by section in the source selector.
