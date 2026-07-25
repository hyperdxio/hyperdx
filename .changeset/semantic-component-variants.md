---
'@hyperdx/app': patch
---

feat: Add semantic component variants wired to the design tokens. `Text` gains `warning`/`success` variants and `Alert` gains `info`/`success`/`warning`/`danger` variants (alongside the existing `danger` for `Button`/`ActionIcon`). Alerts and soft controls use new scheme-aware `--color-bg-*-subtle` (+ `-subtle-hover`) background tokens — lighter tints in light mode, deeper tints in dark mode — with the title, icon, and body text rendered in the semantic color token. Text colors are tuned to meet WCAG AA (4.5:1) on those tints in both schemes. Applies to both the HyperDX and ClickStack themes (ClickStack's `warning` is orange-based since it remaps `yellow` to the brand gold), with new Storybook stories (Components/Alert, Design Tokens/Semantic Variants).
