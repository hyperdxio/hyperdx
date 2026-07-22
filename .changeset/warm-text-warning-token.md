---
'@hyperdx/app': patch
---

feat: Add `--color-text-warning` semantic color token (dark: `#fdb022`, light: `#a16207`) for HyperDX and ClickStack themes, and register it in the Semantic Colors Storybook story. Uses an explicit amber rather than the `yellow` palette so it reads as a true warning in ClickStack, whose `yellow` scale is remapped to the brand gold (a dark olive at the darker shades).
