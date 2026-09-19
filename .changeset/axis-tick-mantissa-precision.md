---
'@hyperdx/app': patch
---

fix: stop discarding chart axis-tick decimals for large numbers

`formatAxisTick` forced every axis tick at or above magnitude 10 to 0 decimal places, no matter what a tile's Number Format configured. Once a value is abbreviated to `k`/`m`/`b`/`t` (which happens for any tick in the thousands or higher), that forced rounding threw away precision the abbreviated label had room for — two ticks like 950 and 1080 both rendered as `1k` instead of something like `950`/`1.08k`. Axis ticks now search downward from the configured decimal places for the most precision that still fits the label's width budget, instead of always rounding to a whole number.
