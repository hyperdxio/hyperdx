---
"@hyperdx/app": minor
---

feat: Multi-theme system with HyperDX and ClickStack branding support

## Major Features

### Multi-Theme System
- Add infrastructure for supporting multiple brand themes (HyperDX & ClickStack)
- Theme switching available in dev/local mode via URL param, localStorage, or keyboard shortcut (Ctrl+Shift+T)
- Production deployments use `NEXT_PUBLIC_THEME` environment variable (deployment-configured)
- Each theme provides its own logos, colors, favicons, and default fonts

### Dynamic Favicons
- Implement theme-aware favicon system with SVG, PNG fallbacks, and Apple Touch Icon
- Add hydration-safe `DynamicFavicon` component
- Include XSS protection for theme-color meta tag validation

### Component Refactoring
- Rename `Icon` → `Logomark` (icon/symbol only)
- Rename `Logo` → `Wordmark` (icon + text branding)
- Each theme provides its own `Logomark` and `Wordmark` components
- Update all component imports across the codebase

### User Preferences Updates
- Rename `theme` property to `colorMode` to clarify light/dark mode vs brand theme
- Remove background overlay feature (backgroundEnabled, backgroundUrl, etc.)
- Add automatic data migration from legacy `theme` → `colorMode` in localStorage
- Ensure existing users don't lose their preferences during migration


### Performance & Type Safety
- Optimize theme CSS class management (single class swap instead of iterating all themes)
- Improve type safety in migration function using destructuring
- Add type guards for runtime validation of localStorage data
