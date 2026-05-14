---
'@hyperdx/app': patch
---

refactor(theme): unify chart palette across HyperDX and ClickStack and address categorical slots by name

The categorical and semantic chart palettes are now identical across
both themes (defined once in `_chart-tokens.scss`, included by both),
and categorical slots are addressed by hue name (`--color-chart-blue`,
`--color-chart-orange`, …) instead of by index (`--color-chart-1`..`-10`).
The numbered vars are removed.

Brand impact: HyperDX charts no longer lead with brand green
(`#00c28a`). They now lead with Observable blue (`#437eef`), matching
ClickStack. Brand identity stays visible via Mantine accent (`green`
on HyperDX), Click UI globals, sidebar gradient, and other UI chrome.

Multi-series ordering moves from CSS to JS via `CATEGORICAL_ORDER` in
`packages/app/src/utils.ts`, so reordering default series colors no
longer requires SCSS edits.
