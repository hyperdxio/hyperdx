---
"@hyperdx/app": patch
---

feat(app): make the selected source clearer in the source picker. The dropdown now marks the current source with a trailing check and a persistent highlight background, adds a small gap between options for readability, and documents the component in Storybook. Introduces a reusable `--color-bg-option-active` theme token (HyperDX + ClickStack, light + dark) for highlighting hovered/selected rows in floating surfaces.
