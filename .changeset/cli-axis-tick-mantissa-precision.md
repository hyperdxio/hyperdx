---
'@hyperdx/cli': patch
---

fix: stop discarding terminal chart axis-tick decimals for large numbers

`axisTickFormatter` is a documented port of the web's `formatAxisTick` and is expected to stay in sync with it, but still forced 0 decimal places for any tick at or above magnitude 10 even after the web side (see the `@hyperdx/app` release in this same PR) started searching for the most precision that fits. `hdx chart` now matches the web's tick labels again (e.g. `1234` at `mantissa: 2` renders `1.23k` on both, not `1k` in the terminal), including the same fix for byte tiles whose `MB`/`GB` unit suffix was throwing off the search's width check, and the same follow-up fixes to that check (a negative percentage like `-0.01%` no longer collapsing to `-0%`, a long unit suffix like `Gibit/s` falling back toward fewer decimals instead of overflowing, and that suffix budget scaling with the suffix's own length so a `numericUnit`-configured tile isn't always forced to 0 decimals).
