---
'@hyperdx/app': patch
---

feat: Add `--color-text-warning` semantic color token based on Mantine's yellow for HyperDX and ClickStack themes, and register it in the Semantic Colors Storybook story. Dark mode uses `yellow-3`; light mode darkens `yellow-9` via `color-mix` so warning text meets WCAG AA (~4.7:1) on light backgrounds (plain yellow-9 is only ~3:1). ClickStack pins the default Mantine yellow as hex because its `yellow` palette is remapped to the brand gold, keeping the warning color consistent across both themes.
