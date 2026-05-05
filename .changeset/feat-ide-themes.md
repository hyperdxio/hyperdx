---
'@hyperdx/app': minor
---

feat: add IDE-inspired themes (Nord, Catppuccin, One Dark)

- Add Nord theme with Polar Night dark and Snow Storm light palettes
- Add Catppuccin theme with Mocha dark and Latte light palettes
- Add One Dark theme with One Dark dark and One Light palettes
- Extract shared chart color palette into a reusable `@mixin chart-tokens` in `_shared-chart-tokens.scss`
- Add `themes/_shared/Logomark` and `Wordmark` components for IDE themes — adaptive black/white based on color mode
- Extend `ThemeName` union and theme registry to support new theme names
- Add theming contributor guide at `agent_docs/theming.md`
