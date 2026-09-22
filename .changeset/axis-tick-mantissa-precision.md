---
'@hyperdx/app': patch
'@hyperdx/cli': patch
---

fix: stop discarding chart axis-tick decimals for large numbers

Axis ticks at or above 1k were always rounded to a whole number regardless of the configured Number Format, so nearby values (e.g. 950 and 1080) could both render as `1k` — ticks now use as much precision as the axis's width allows, on both the web app and CLI terminal charts. Also fixed: a tightly fit Y-axis could show two ticks with the identical rounded label.
