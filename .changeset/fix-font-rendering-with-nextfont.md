---
'@hyperdx/app': minor
---

# Font Rendering Fix

Migrate from Google Fonts CDN to Next.js self-hosted fonts for improved reliability and production deployment.

## Changes

- Replaced Google Fonts imports with `next/font/google` for IBM Plex Mono, Roboto Mono, Inter, and Roboto
- Font variables are applied server-side in `_document.tsx` and available globally via CSS class inheritance
- Implemented dynamic font switching with CSS variables (`--app-font-family`) and Mantine theme integration
- Font configuration centralized in `src/config/fonts.ts` with derived maps for CSS variables and Mantine compatibility
- Added Roboto font option alongside existing fonts (IBM Plex Mono, Roboto Mono, Inter)
- CSS variable always has a value (defaults to Inter) even when user preference is undefined
- Removed old Google Fonts CDN links from `_document.tsx`
- `!important` flag used only in CSS for external components (nextra sidebar), not in inline styles
- Fonts are now available globally without external CDN dependency, fixing production deployment issues

## Benefits

- ✅ Self-hosted fonts that work in production even when CDNs are blocked
- ✅ Improved performance with automatic optimization
- ✅ Works with Content Security Policy (CSP) headers
- ✅ Mantine components and sidebar now properly inherit selected fonts
- ✅ Font selection persists through user preferences
- ✅ DRY font configuration with derived maps prevents duplication
- ✅ Server-side font setup eliminates runtime performance overhead
