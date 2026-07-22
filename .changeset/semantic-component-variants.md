---
'@hyperdx/app': patch
---

feat: Add semantic component variants wired to the design tokens. `Button`, `ActionIcon`, and `Text` gain `warning` and `success` variants (alongside the existing `danger`), and `Alert` gains `info`/`success`/`warning`/`danger` variants that tint the callout and accent the title/icon with the semantic color tokens while keeping the body text high-contrast. Applies to both the HyperDX and ClickStack themes, with new Storybook stories (Components/Alert, Design Tokens/Semantic Variants).
