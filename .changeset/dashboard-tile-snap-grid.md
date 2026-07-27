---
'@hyperdx/app': patch
---

feat: Show a snap grid while dragging or resizing a dashboard tile

While a dashboard tile is dragged or resized, the grid it snaps to is drawn behind the tiles and the cells where the tile will land are highlighted, so the drop target is clear. The highlight follows where the tile actually settles, including when the grid compacts it away from the cursor, rather than the raw cursor position. The overlay uses the same geometry as react-grid-layout, appears once the tile starts moving, and clears on release.
