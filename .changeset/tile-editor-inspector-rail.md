---
'@hyperdx/app': minor
---

feat: Redesign the tile editor's secondary editors into one docked "Tile settings" rail. Display Settings and Row Click Action now live in a single side panel with a section switcher (instead of separate stacked drawers), and per-series color and display-format editors open as popovers anchored to the series row. All of these write live to the tile draft, so the tile's own Save/Cancel is the single commit point (the per-section Apply buttons are gone) and a single Esc closes just the panel. The multi-series editor rows are now compact — a color swatch, a one-line summary that expands on demand, a display-format control, and a single overflow (⋮) menu for Duplicate / Move up / Move down / Remove.
