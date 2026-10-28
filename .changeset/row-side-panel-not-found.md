---
'@hyperdx/app': patch
---

fix: Show "Event not found" in the row side panel when the row lookup returns nothing, instead of rendering the tabs with an invalid time range that made ClickHouse reject follow-up queries
