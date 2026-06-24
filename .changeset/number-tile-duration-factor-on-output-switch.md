---
"@hyperdx/app": patch
---

fix(dashboards): seed the duration unit when switching a number tile to Duration

Switching the Output format to Duration (or Time) on a number tile now seeds the
input unit from the datasource precision. Previously the unit stayed on Seconds,
so a nanosecond trace Duration value was read as seconds (a 367ms value showed as
roughly 11.7 years) until the user re-picked Nanoseconds by hand. Tiles whose
source has no detected duration precision keep the existing behavior.
