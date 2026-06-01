---
'@hyperdx/app': patch
---

fix(PageHeader): keep sticky header below drawer overlays

The sticky page header sat at `z-index: 100`, which floated it above app
drawers (drawers opt into a lower stack via `ZIndexContext`, putting the
overlay at `z-index: 10`). The header now sits at `z-index: 2` — 8 below
the top-level drawer — so drawer overlays reliably cover the page chrome
while the header still wins against normal scrolling content.
