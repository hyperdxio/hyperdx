---
'@hyperdx/app': minor
---

# Font Rendering Fix

Migrate from Google Fonts CDN to Next.js self-hosted fonts for improved reliability and production deployment.

## Changes

- Replaced Google Fonts imports with `next/font/google` for IBM Plex Mono, Roboto Mono, Inter, and Roboto
- Font variables are now applied to both `documentElement` and `body` for global accessibility
- Implemented dynamic font switching with CSS variables and Mantine theme integration
- Added `!important` flag to ensure font-family overrides work consistently across all components
- Set `var(--font-inter)` as the default font variable when no user preference is available
- Fonts are now available globally without external CDN dependency, fixing production deployment issues

## Benefits

- ✅ Self-hosted fonts that work in production even when CDNs are blocked
- ✅ Improved performance with automatic optimization
- ✅ Works with Content Security Policy (CSP) headers
- ✅ Mantine components now properly inherit selected fonts
- ✅ Font selection persists through user preferences
