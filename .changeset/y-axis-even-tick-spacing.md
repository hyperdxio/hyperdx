---
'@hyperdx/app': patch
---

fix: keep Y-axis ticks evenly spaced when Recharts thins them for overlap

A chart's Y-axis could render unevenly spaced ticks, e.g. `0`, `300`, `1k` (gaps of 300 then 700) instead of `0`, `250`, `500`, `750`, `1k` — even though the underlying scale is linear. Recharts generates its own "nice" candidate tick values and then thins them via `minTickGap` to avoid overlapping labels, but that thinning drops individual candidates without re-spacing the survivors, so an already slightly uneven candidate set could come out badly uneven.

The Y-axis now feeds Recharts a genuinely uniform set of candidate ticks (evenly dividing the domain into quarters) instead. Thinning a uniform sequence for overlap always keeps every Nth candidate, so however many ticks survive stay evenly spaced — this doesn't change how many ticks are shown, only where they land.
