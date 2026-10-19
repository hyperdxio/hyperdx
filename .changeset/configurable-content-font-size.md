---
'@hyperdx/app': minor
---

feat: add a content font size preference

Small text in the log/trace table was not adjustable without browser zoom, which
also shrinks the surrounding chrome. User preferences now carry a **Content font
size** setting (small / medium / large) that scales the search results table,
data tables, expanded row JSON, and chart axes, legends, and tooltips. Small is
the default and matches the previous sizes, so nothing changes until you opt in.
