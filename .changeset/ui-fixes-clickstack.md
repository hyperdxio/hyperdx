---
"@hyperdx/app": patch
---

feat: Theme-aware UI improvements for ClickStack

- **Chart colors**: Made chart color palette theme-aware - ClickStack uses blue as primary color, HyperDX uses green. Charts now correctly display blue bars for ClickStack theme.
- **Semantic colors**: Updated semantic color functions (getChartColorSuccess, getChartColorWarning, getChartColorError) to be theme-aware, reading from CSS variables or falling back to theme-appropriate palettes.
- **Info log colors**: Changed info-level logs to use primary chart color (blue for ClickStack, green for HyperDX) instead of success green.
- **Button variants**: Made ResumeLiveTailButton variant conditional - uses 'secondary' for ClickStack theme, 'primary' for HyperDX theme.
- **Nav styles**: Fixed collapsed navigation styles for proper alignment and spacing when nav is collapsed to 50px width.
- **Icon stroke width**: Added custom stroke width (1.5) for Tabler icons in ClickStack theme only, providing a more refined appearance.
