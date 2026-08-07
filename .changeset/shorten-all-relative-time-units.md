---
'@hyperdx/app': patch
---

fix: Abbreviate every unit in relative timestamps

Plural months rendered as `3mo.s ago`, and `1 second`, `1 year` and `2 years`
were not abbreviated at all, so session lists and the row side panel mixed
`5m ago` with `2 years ago`.
