---
'@hyperdx/app': patch
---

feat: Show a snap grid while dragging or resizing a dashboard tile

While a dashboard tile is dragged or resized, the grid it snaps to is drawn behind the tiles and the cells around the tile's current position are highlighted, so the drop target is clear. The overlay uses the same geometry as react-grid-layout, so the guides line up with where a tile actually lands, and it clears on drop.
