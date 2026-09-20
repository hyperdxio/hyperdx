---
'@hyperdx/app': patch
---

feat: reveal search row-selection checkboxes on hover

The multi-select checkbox now fades in when a row is hovered or the checkbox
takes keyboard focus, instead of sitting on every row all the time. Selecting
any row reveals every checkbox so shift-click ranges stay aimable, and touch
devices (no hover) keep them visible. The cell keeps its width in every state,
so nothing reflows on hover.
