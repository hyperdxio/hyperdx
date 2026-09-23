---
'@hyperdx/app': patch
---

Fix: clicking the "Add Alert" icon on a dashboard tile now opens the tile editor
with the alert editor already showing, instead of an empty editor where the user
had to click "Add Alert" a second time. Opening via the icon seeds the tile's
default alert (matching the in-editor button, including the display-name seed);
an existing alert and local mode are left unchanged.
