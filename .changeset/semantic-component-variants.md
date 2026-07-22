---
'@hyperdx/app': patch
---

feat: Add semantic component variants wired to the design tokens. `Button`, `ActionIcon`, and `Text` gain `warning` and `success` variants (alongside the existing `danger`), and `Alert` gains `info`/`success`/`warning`/`danger` variants. Alerts use a scheme-aware tinted background (lighter in light mode, darker in dark mode) with the title, icon, and body text all rendered in the semantic color token. Applies to both the HyperDX and ClickStack themes, with new Storybook stories (Components/Alert, Design Tokens/Semantic Variants).
