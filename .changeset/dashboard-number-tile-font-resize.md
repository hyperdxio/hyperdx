---
'@hyperdx/app': patch
---

feat(dashboard): auto-resize font in number tiles to fit container

Number tiles now automatically scale their font size to fit the available
width, preventing text overflow on narrow tiles and making better use of
space on wide ones. Includes an error boundary so a single broken tile
does not crash the entire dashboard.
