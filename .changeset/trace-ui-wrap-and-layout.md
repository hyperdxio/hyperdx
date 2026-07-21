---
"@hyperdx/app": patch
---

fix: Improve the trace/span detail UI (HDX-4853)

- Long span attribute values with no break points (e.g. `url.path`) now wrap
  fully when wrap mode is on instead of being clipped.
- Add a toggle to move the selected span's detail panel between the right side
  (default) and the bottom of the waterfall, restoring the older top/bottom
  layout.
