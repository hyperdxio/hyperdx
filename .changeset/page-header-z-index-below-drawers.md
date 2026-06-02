---
'@hyperdx/app': patch
---

fix(z-index): keep sticky header below drawers and drawers above the fullscreen tile modal

Two related z-index regressions:

- `PageHeader` was pinned at `z-index: 100`, but app drawers opt into a
  much lower stack via `ZIndexContext` (`contextZIndex + 10`, so a
  top-level drawer renders at `z-index: 10`). The sticky header therefore
  floated above the drawer overlay. The header now sits at `z-index: 2` so
  drawer overlays reliably cover the page chrome while the header still
  wins against normal scrolling content.
- `FullscreenPanelModal` used Mantine's default modal z-index (`200`) and
  didn't propagate it through `ZIndexContext`. Clicking a row in a
  fullscreen search tile opened a `DBRowSidePanel` drawer at `z-index: 10`
  that was hidden behind the modal. The modal now follows the existing
  `contextZIndex + 10` pattern and wraps its children in a
  `ZIndexContext.Provider`, so child drawers stack on top of it.
