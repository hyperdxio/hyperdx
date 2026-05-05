# Theming

## Two independent theming concepts

The app has **two separate, orthogonal theming systems** that must not be confused:

| Concept | What it controls | Who sets it | Where it lives |
|---|---|---|---|
| **Color mode** | Dark / light appearance | User preference | `useUserPreferences().colorMode`, stored in `hdx-user-preferences` localStorage |
| **Brand theme** | Accent colors, logos, favicons | Deployment config | `NEXT_PUBLIC_THEME` env var, `hdx-dev-theme` localStorage (dev only) |

A single deployment is always one brand theme. Users can freely toggle light/dark within that brand. The CSS system handles both simultaneously via scoped selectors:

```css
.theme-nord[data-mantine-color-scheme='dark'] { … }
.theme-nord[data-mantine-color-scheme='light'] { … }
```

---

## File structure

```
packages/app/src/theme/
├── types.ts                          # ThemeName union, ThemeConfig interface
├── index.ts                          # Theme registry, Zod validation, getTheme()
├── ThemeProvider.tsx                 # AppThemeProvider context + useAppTheme() hook
└── themes/
    ├── _base-tokens.scss             # SSR fallback — @use all theme token modules
    ├── _shared-chart-tokens.scss     # Shared @mixin chart-tokens (reused by all themes)
    ├── _shared/
    │   ├── Logomark.tsx              # Generic hex+bolt logo (text-colored, light/dark adaptive)
    │   └── Wordmark.tsx              # Wordmark using the shared Logomark
    ├── hyperdx/                      # HyperDX brand (green accent)
    │   ├── _tokens.scss              # dark-mode-tokens / light-mode-tokens mixins + scoped rules
    │   ├── mantineTheme.ts           # MantineThemeOverride (primaryColor: 'green')
    │   ├── Logomark.tsx              # Green hex+bolt logo
    │   ├── Wordmark.tsx
    │   └── index.ts                  # ThemeConfig export: hyperdxTheme
    ├── clickstack/                   # ClickStack brand (yellow accent, distinct logo)
    │   └── …                         # Same structure; unique Logomark/Wordmark
    ├── nord/                         # Nord IDE theme (blue accent)
    │   └── …
    ├── catppuccin/                   # Catppuccin Mocha/Latte (mauve accent)
    │   └── …
    └── onedark/                      # One Dark/Light (blue accent)
        └── …
```

---

## How CSS variables are applied

1. `pages/_document.tsx` sets the initial `<html class="theme-{name}">` during SSR using `NEXT_PUBLIC_THEME`, so CSS variables are populated before JS runs.
2. Mantine sets `data-mantine-color-scheme="dark|light"` on `<html>` based on user preference.
3. Each theme's `_tokens.scss` declares two scoped blocks that match both attributes together:

```scss
.theme-nord[data-mantine-color-scheme='dark']  { @include dark-mode-tokens; }
.theme-nord[data-mantine-color-scheme='light'] { @include light-mode-tokens; }
```

4. `_base-tokens.scss` `@use`s every theme module so their scoped CSS blocks land in the compiled bundle. It also provides unscoped `[data-mantine-color-scheme]` fallback rules (using HyperDX tokens) for SSR before JS attaches the theme class.
5. `ThemeProvider.tsx` swaps the `theme-*` class on `document.documentElement` when the theme changes at runtime.

---

## Semantic CSS variables

Components must use the semantic `--color-*` custom properties, not raw Mantine palette values. All themes define the same variable names so components are theme-agnostic.

Key groups (defined in every `_tokens.scss`):

| Group | Example variables |
|---|---|
| Backgrounds | `--color-bg-body`, `--color-bg-surface`, `--color-bg-muted`, `--color-bg-hover`, `--color-bg-field`, `--color-bg-brand` |
| Text | `--color-text`, `--color-text-primary`, `--color-text-muted`, `--color-text-brand`, `--color-text-danger` |
| Borders | `--color-border`, `--color-border-emphasis`, `--color-border-muted` |
| Icons | `--color-icon-primary`, `--color-icon-muted` |
| States | `--color-state-hover`, `--color-state-selected`, `--color-outline-focus` |
| Primary button | `--color-primary-button-bg`, `--color-primary-button-bg-hover`, `--color-primary-button-text` |
| Sidenav | `--color-bg-sidenav`, `--color-bg-sidenav-link-active`, `--color-text-sidenav-link-active` |
| Slider | `--color-slider-bar`, `--color-slider-thumb`, `--color-slider-dot` |
| Code/kbd | `--color-bg-code`, `--color-border-code`, `--color-bg-kbd` |
| JSON highlighting | `--color-json-key`, `--color-json-string`, `--color-json-number`, … |
| Charts | `--color-chart-1` … `--color-chart-10`, `--color-chart-success`, `--color-chart-error`, … |

Full canonical list: `packages/app/src/theme/semanticColorsGrouped.ts`.

---

## Shared chart tokens

`themes/_shared-chart-tokens.scss` exports `@mixin chart-tokens` — the Observable 10 categorical palette used by every theme except HyperDX (which uses a green-first variant). Include it inside each mode's mixin to avoid duplication:

```scss
@use '../shared-chart-tokens' as chart;

@mixin dark-mode-tokens {
  /* … theme-specific tokens … */
  @include chart.chart-tokens;
}
```

---

## Logos

Three logo variants exist:

| Theme | Logomark | Source |
|---|---|---|
| `hyperdx` | Hex + bolt, filled with `--color-bg-brand` (green) | `themes/hyperdx/Logomark.tsx` |
| `clickstack` | Distinct bar-chart icon, `currentColor` | `themes/clickstack/Logomark.tsx` |
| All others | Hex + bolt, filled with `--color-text` (white/black by color mode) | `themes/_shared/Logomark.tsx` |

When adding a new IDE-inspired theme, import from `themes/_shared/`.

---

## Adding a new theme — checklist

### 1. Create the theme directory

```
themes/{name}/
├── _tokens.scss
├── mantineTheme.ts
└── index.ts
```

No separate Logomark/Wordmark needed — import from `themes/_shared/` unless this is a distinct brand with its own identity.

### 2. Write `_tokens.scss`

Define `@mixin dark-mode-tokens` and `@mixin light-mode-tokens` then apply them to scoped selectors:

```scss
@use '../shared-chart-tokens' as chart;

@mixin dark-mode-tokens {
  --color-bg-body: #1e1e2e;
  /* … all required --color-* vars … */
  @include chart.chart-tokens;
  --mantine-color-body: var(--color-bg-body) !important;
  --mantine-color-text: var(--color-text);
}

@mixin light-mode-tokens {
  /* … */
}

.theme-{name}[data-mantine-color-scheme='dark']  { @include dark-mode-tokens; }
.theme-{name}[data-mantine-color-scheme='light'] { @include light-mode-tokens; }
```

Use `_tokens.scss` from an existing IDE theme (`nord`, `catppuccin`, etc.) as a template — every required variable is already listed there.

### 3. Write `mantineTheme.ts`

Copy `themes/hyperdx/mantineTheme.ts` and adjust:
- `primaryColor` — the Mantine palette key that matches your accent (`'blue'`, `'teal'`, `'violet'`, etc.)
- `primaryShade` — `{ dark: N, light: N }` targeting your accent shade
- `colors` — optionally override the palette for exact hex values

The component overrides (`Button`, `ActionIcon`, `Tabs`, etc.) reference `--color-*` vars and can be copied verbatim.

### 4. Write `index.ts`

```ts
import { ThemeConfig } from '../../types';
import Logomark from '../_shared/Logomark';
import Wordmark from '../_shared/Wordmark';
import { theme } from './mantineTheme';

export const myTheme: ThemeConfig = {
  name: 'mytheme',          // must match ThemeName union
  displayName: 'My Theme',
  mantineTheme: theme,
  Wordmark,
  Logomark,
  cssClass: 'theme-mytheme',
  favicon: {
    svg: '/favicons/hyperdx/favicon.svg',
    png32: '/favicons/hyperdx/favicon-32x32.png',
    png16: '/favicons/hyperdx/favicon-16x16.png',
    appleTouchIcon: '/favicons/hyperdx/apple-touch-icon.png',
    themeColor: '#1e1e2e',  // dominant dark-mode background
  },
};
```

### 5. Register the theme in four places

**`types.ts`** — extend the union:
```ts
export type ThemeName = 'hyperdx' | 'clickstack' | 'nord' | … | 'mytheme';
```

**`theme/index.ts`** — import, validate, and register:
```ts
import { myTheme } from './themes/mytheme';

// add to validateThemeConfig calls:
validateThemeConfig(myTheme, 'mytheme');

// add to registry:
export const themes: Record<ThemeName, ThemeConfig> = {
  …
  mytheme: myTheme,
};

// update Zod enum:
name: z.enum(['hyperdx', 'clickstack', …, 'mytheme']),
```

**`themes/_base-tokens.scss`** — add the `@use` so the scoped CSS is bundled:
```scss
@use './mytheme/tokens' as mytheme-tokens;
```

**`pages/_document.tsx`** — add to `VALID_THEME_NAMES`:
```ts
const VALID_THEME_NAMES = ['hyperdx', 'clickstack', …, 'mytheme'] as const;
```

---

## Switching themes in development

The brand theme is deployment-configured (`NEXT_PUBLIC_THEME`), but in dev/local mode it can be overridden without restarting:

```js
// Browser console
window.__HDX_THEME.set('nord')    // switch to a theme
window.__HDX_THEME.toggle()       // cycle between themes
window.__HDX_THEME.clear()        // revert to env default
```

Or use the **Brand Theme** selector in the User Preferences modal (only visible when `NODE_ENV === 'development'` or `NEXT_PUBLIC_IS_LOCAL_MODE === 'true'`).
