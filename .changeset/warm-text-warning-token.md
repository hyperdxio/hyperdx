---
'@hyperdx/app': patch
---

feat: Add `--color-text-warning` semantic color token based on Mantine's yellow (dark: `yellow-3`, light: `yellow-9`) for HyperDX and ClickStack themes, and register it in the Semantic Colors Storybook story. ClickStack pins the default Mantine yellow as hex because its `yellow` palette is remapped to the brand gold, keeping the warning color consistent across both themes.
