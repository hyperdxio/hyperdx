---
"@hyperdx/app": patch
---

fix(dashboards): keep the auto-detected number format when applying display settings

Opening Display Settings on a number tile that auto-detects its format from the
datasource (for example p95 of a trace Duration column) and clicking Apply no
longer rewrites the format to Number. The drawer now reflects the
datasource-derived format, and Apply persists `numberFormat` only when the user
explicitly changes it; otherwise it stays unset so render-time auto-detection
keeps driving the format.
