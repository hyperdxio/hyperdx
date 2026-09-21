---
'@hyperdx/cli': patch
---

fix: stop discarding terminal chart axis-tick decimals for large numbers

`axisTickFormatter` is a documented port of the web's `formatAxisTick` and is expected to stay in sync with it, but still forced 0 decimal places for any tick at or above magnitude 10 even after the web side (see the `@hyperdx/app` release in this same PR) started searching for the most precision that fits. `hdx chart` now matches the web's tick labels again (e.g. `1234` at `mantissa: 2` renders `1.23k` on both, not `1k` in the terminal), the same follow-up fixes (a negative percentage like `-0.01%` no longer collapsing to `-0%`, and a tick under 1 with a short unit suffix like `0.25 cps` no longer collapsing to a misleading `0`), and the same long-suffix backoff (a tick under 1 pinned to `Gibit/s` still shows as a whole number, since that overflow is too wide to be worth it). One difference from the web: the termchart gutter is a fixed 10-column width, not the web's 40px SVG axis, so the terminal has more room for a unit suffix and correctly keeps `1.2 GiB`/`1.4 GiB` distinct where the web (out of room) still can't.
