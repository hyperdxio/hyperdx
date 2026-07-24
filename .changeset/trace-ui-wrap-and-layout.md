---
"@hyperdx/app": patch
---

fix: Improve the trace/span detail UI (HDX-4853)

- Long span attribute values with no break points (e.g. `url.path`) now wrap
  fully when wrap mode is on instead of being clipped.
- Long attribute keys (e.g. `longtask.attribution.entry_type`) now wrap and
  are capped at half the row width so they can't squeeze the value column to
  nothing.
- Add a toggle to move the selected span's detail panel between the right side
  (default) and the bottom of the waterfall, restoring the older top/bottom
  layout.
- The span detail panel's Overview/Column Values content now aligns flush
  with the tab bar instead of being inset by extra padding.
