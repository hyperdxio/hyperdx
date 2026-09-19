---
'@hyperdx/cli': patch
---

fix: keep duration axis-tick labels compact in terminal charts

`axisTickFormatter` (the CLI's documented port of the web's `formatAxisTick`, fixed in #3148) fell through to the wide `formatDurationMs` for duration-formatted charts instead of the compact formatter, so `hdx chart` still rendered labels like "13.33min" in a terminal column even narrower than the browser's.
