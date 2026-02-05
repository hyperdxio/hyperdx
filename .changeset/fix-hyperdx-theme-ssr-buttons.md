---
'@hyperdx/app': patch
---

fix: Apply theme CSS class during SSR to prevent button styling mismatch

Adds the theme class (e.g., `theme-hyperdx`) to the HTML element during server-side rendering in `_document.tsx`. This ensures CSS variables for button styling are correctly applied from the first render, preventing a hydration mismatch that caused primary buttons to display with Mantine's default styling instead of the custom theme styling when `NEXT_PUBLIC_THEME` was explicitly set.
