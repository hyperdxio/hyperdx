---
'@hyperdx/cli': patch
---

fix: use compact duration labels on terminal chart axis ticks

`axisTickFormatter` is a documented port of the web's `formatAxisTick` (fixed in #3148) and is expected to stay behaviorally in sync with it, but it fell through to the wide `formatDurationMs` instead of the compact formatter for duration-formatted charts. `hdx chart` now renders the same short labels (e.g. "13m" instead of "13.33min") as the web app.
