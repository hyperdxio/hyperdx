---
"@hyperdx/app": patch
---

Fix trace waterfall span bars losing their duration proportions when zoomed
in. The span-bar minimum width was applied as a percentage of the events area,
which the zoom model widens via `width`, so the floor scaled with the zoom
factor and very short spans grew as wide as multi-second ones. The floor is now
a fixed pixel `minWidth`, so bar widths stay proportional to duration at every
zoom level while sub-pixel spans remain clickable.
