# Themes (HyperDX & ClickStack)

> How the brand theme system works, how it interacts with light/dark color
> mode, and where to make changes safely. Read this before touching anything
> in `packages/app/src/theme/`, before adding a new brand, or before
> hard-coding any color, logo, or favicon path in the app.
>
> For **chart colors specifically** (categorical palette, heatmap gradient,
> semantic success/warn/error chart colors) see
> [`data_viz_colors.md`](data_viz_colors.md) — it covers the chart-specific
> rules in more depth. This doc covers everything else.

## TL;DR

The app has **two independent theming concepts**:

| Concept            | Values                         | Who controls it             | Stored in                                  | What it affects                                       |
| ------------------ | ------------------------------ | --------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| **Brand theme**    | `hyperdx` \| `clickstack`      | Deployment (build/env)      | `NEXT_PUBLIC_THEME` + html class           | Branding: logos, favicons, accent colors, fonts       |
| **Color mode**     | `light` \| `dark` \| `system`  | End user (preferences UI)   | `localStorage: hdx-user-preferences`       | Light/dark appearance: backgrounds, text, borders     |

Each deployment ships **one** brand theme. Users can flip between light and
dark inside that brand but cannot switch brands in production. In dev you
can override the brand via `window.__HDX_THEME.set('clickstack')`.

The runtime wiring is:

1. Server-side (`pages/_document.tsx`) puts `theme-hyperdx` or
   `theme-clickstack` on `<html>` based on `NEXT_PUBLIC_THEME`.
2. An inline script (`SystemColorSchemeScript`) sets
   `data-mantine-color-scheme="light|dark"` on `<html>` from
   `localStorage.hdx-user-preferences.colorMode` before React hydrates.
3. SCSS in `packages/app/src/theme/themes/{brand}/_tokens.scss` defines all
   semantic CSS variables (`--color-bg-body`, `--color-text-primary`, …)
   inside `.theme-{brand}[data-mantine-color-scheme='{mode}']` selectors —
   one block per (brand × mode) combination, four blocks total.
4. Mantine config (`{brand}/mantineTheme.ts`) sets `primaryColor`,
   font, spacing, and per-component overrides — most colors come back out
   via CSS vars rather than Mantine palette entries.
5. React reads the active brand via `useAppTheme()` (rarely needed —
   prefer CSS vars).

**Hard rules**:

- **Never** hard-code a hex/named color in a component. Use a semantic CSS
  var (`var(--color-bg-surface)`, `var(--color-text-primary)`, …).
- **Never** branch on `themeName` to choose colors. The CSS var already
  resolves to the right value per brand. Branching is OK for *layout* or
  *content* differences (different copy, different logo placement) — not
  colors.
- **Never** confuse `IS_CLICKHOUSE_BUILD` with the theme. That flag gates
  *features* (e.g. embedded mode, ClickHouse Cloud onboarding) and is
  unrelated to brand colors. A `clickstack`-themed build can have
  `IS_CLICKHOUSE_BUILD=false` and vice versa.

## Brand theme

### Where the themes are defined

Everything lives under `packages/app/src/theme/`:

```text
theme/
├── index.ts                  # Registry, validation, DEFAULT_THEME, getDevThemeName
├── types.ts                  # ThemeName, ThemeConfig, FaviconConfig types
├── ThemeProvider.tsx         # AppThemeProvider + useAppTheme/useWordmark/useLogomark hooks
├── semanticColorsGrouped.ts  # Grouping metadata for the storybook
├── ChartColors.stories.tsx   # Visual reference for chart palette
├── SemanticColors.stories.tsx# Visual reference for semantic vars
├── themes/
│   ├── _base-tokens.scss     # Fallback vars when no theme class is applied (SSR safety)
│   ├── components.module.scss# Shared component overrides (slider marks, etc.)
│   ├── hyperdx/
│   │   ├── index.ts          # ThemeConfig export: name, displayName, logos, favicon, mantineTheme
│   │   ├── _tokens.scss      # All semantic CSS vars (dark + light), scoped to .theme-hyperdx
│   │   ├── mantineTheme.ts   # Mantine palette + component overrides
│   │   ├── Logomark.tsx      # Icon-only logo (used in collapsed sidenav, favicons context)
│   │   └── Wordmark.tsx      # Full "HyperDX" wordmark
│   └── clickstack/
│       ├── index.ts          # Same shape as hyperdx/index.ts
│       ├── _tokens.scss      # Same shape — adds Click UI palette + yellow brand
│       ├── mantineTheme.ts   # Same shape — yellow primaryColor
│       ├── Logomark.tsx
│       └── Wordmark.tsx
└── __tests__/                # ThemeProvider + theme validation tests
```

Favicons live under `packages/app/public/favicons/{brand}/`. The
`FaviconConfig` type in `types.ts` enforces the directory/filename
convention via Zod.

### Each `ThemeConfig` ships:

```ts
type ThemeConfig = {
  name: 'hyperdx' | 'clickstack';
  displayName: string;              // 'HyperDX' | 'ClickStack' — used in UI copy
  cssClass: string;                 // 'theme-hyperdx' | 'theme-clickstack'
  mantineTheme: MantineThemeOverride;
  Wordmark: React.ComponentType;
  Logomark: React.ComponentType<{ size?: number }>;
  favicon: { svg, png32, png16, appleTouchIcon, themeColor };
};
```

The registry in `theme/index.ts` validates both themes against a Zod
schema at module load time. In production, a failed validation throws;
in development it logs and falls back to `hyperdx`.

### How brand resolution works at runtime

| Phase                       | Source of truth                                    | Notes                                                                              |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| SSR (`_document.tsx`)       | `process.env.NEXT_PUBLIC_THEME`                    | Adds `theme-{name}` class to `<html>` so SCSS vars resolve on the first paint.     |
| Initial React render        | `propsThemeName ?? DEFAULT_THEME` in provider      | Matches SSR — never reads localStorage during render to avoid hydration mismatch.  |
| Post-hydration (dev only)   | `localStorage.hdx-dev-theme` via `getDevThemeName` | Updates state in a `useEffect`. Causes a one-frame flash; intentional for dev UX.  |
| Post-hydration (prod)       | Stable — no reads from storage                     | `setTheme`/`toggleTheme` are no-ops in production. Confirmed by the `IS_DEV` gate. |

`IS_DEV` is true when `NODE_ENV === 'development'` **or**
`NEXT_PUBLIC_IS_LOCAL_MODE === 'true'` — so the OSS local-mode build also
exposes the dev theme switcher in `UserPreferencesModal`.

### Dev-mode theme switching

Three ways to flip brand in dev:

1. **UI**: open the user preferences modal — there's a "Brand theme"
   select gated on `isDev`.
2. **Console**: `window.__HDX_THEME.set('clickstack')`,
   `window.__HDX_THEME.toggle()`, `window.__HDX_THEME.clear()`.
3. **Storage**: set `localStorage.setItem('hdx-dev-theme', 'clickstack')`
   and reload.

`clear()` removes the override and reverts to `NEXT_PUBLIC_THEME` (or
`hyperdx` if unset).

## Color mode (light / dark / system)

Color mode is **per-user**, persisted to
`localStorage.hdx-user-preferences` under the `colorMode` key. Defined in
`packages/app/src/useUserPreferences.tsx`:

- Values: `'system' | 'light' | 'dark'`. Default `'system'`.
- `'system'` follows `window.matchMedia('(prefers-color-scheme: dark)')`
  and reacts to changes.
- The inline `SystemColorSchemeScript` (rendered very early) sets
  `data-mantine-color-scheme` before React hydrates so there's no flash.
- `useResolvedColorScheme()` returns the resolved `'light' | 'dark'` for
  consumption by `ThemeWrapper` (which forwards it to `MantineProvider`
  as `forceColorScheme`).

The user preferences storage also handles **migration from the legacy
`theme` key** — older versions used `theme: 'light'|'dark'|'system'`;
the migration code in `useUserPreferences.tsx` rewrites it to
`colorMode` so existing users don't lose their preference. Don't
re-introduce the old name.

### Why two attributes (`class` + `data-attr`)?

```html
<html class="theme-clickstack" data-mantine-color-scheme="dark">
```

The combined selector `.theme-clickstack[data-mantine-color-scheme='dark']`
in `_tokens.scss` lets a single SCSS file define **all four** variants
(2 brands × 2 modes) without duplication at the call site. Each block
redefines `--color-bg-body`, `--color-text`, etc. for that specific
combination. There is no JS branching on brand/mode for color
resolution — CSS handles it.

## How to consume themes in code

### From CSS / SCSS

Just use the semantic vars. They resolve automatically based on the
brand + mode classes on `<html>`:

```scss
.sidenav {
  background: var(--color-bg-sidenav);
  color: var(--color-text-sidenav-link);
  border-right: 1px solid var(--color-border);
}

.sidenav__link[data-active='true'] {
  background: var(--color-bg-sidenav-link-active);
  color: var(--color-text-sidenav-link-active);
}
```

The full list of semantic vars is in
`packages/app/src/theme/semanticColorsGrouped.ts` (used to build the
storybook story). Categories: backgrounds, borders, text, icons,
overlay, states, json (syntax highlight), charts.

### From React (inline style, when CSS won't reach)

Use the var string directly in `style={}` — `MantineProvider` doesn't
need to know about it:

```tsx
<Box style={{ background: 'var(--color-bg-surface)' }} />
```

Use **`useMantineColorScheme()`** when you genuinely need to branch on
`light` vs `dark` (e.g. picking a heatmap palette). Don't branch on it
to pick a semantic color — the var does that for you.

### From React (reading the active brand)

```tsx
import { useAppTheme, useThemeName, useBrandDisplayName } from '@/theme/ThemeProvider';

function Header() {
  const { theme } = useAppTheme();          // full ThemeConfig
  const themeName = useThemeName();          // 'hyperdx' | 'clickstack'
  const brand = useBrandDisplayName();       // 'HyperDX' | 'ClickStack' — use in UI copy
  // …
}
```

Use these only for:

- **Logo / wordmark rendering** — but prefer `useWordmark()` /
  `useLogomark()`, which return memoized JSX.
- **Brand-specific UI copy** — e.g. "Connect ClickStack" vs "Connect HyperDX".
- **Rare layout differences** — e.g. ClickStack hides the font picker
  because it's locked to Inter (see `_app.tsx`).

**Don't use `themeName` to pick colors.** Bad:

```tsx
// ❌ bypasses the whole CSS var system, breaks dark mode, breaks future themes
const accent = themeName === 'clickstack' ? '#faff69' : '#00c28a';
```

Good:

```tsx
// ✅ resolves correctly for both brands and both color modes
<Box style={{ background: 'var(--color-bg-brand)' }} />
```

### Logos

```tsx
import { useWordmark, useLogomark } from '@/theme/ThemeProvider';

function TopBar() {
  const wordmark = useWordmark();
  const logo = useLogomark({ size: 24 });
  return <Group>{logo}{wordmark}</Group>;
}
```

Both hooks return memoized JSX elements so component identity stays
stable across renders.

## Per-brand differences

### HyperDX (default, green-first)

- Mantine `primaryColor: 'green'`, `primaryShade: 8`.
- Brand palette: custom green ramp in `hyperdx/mantineTheme.ts` (peaks
  at `#00c28a`).
- Fonts: user-selectable via `useUserPreferences().font` (IBM Plex Sans
  default). The font picker is visible in the preferences modal.
- Semantic success **uses the brand green**; that's intentional. A
  green chart series next to a green success pill is expected, not a
  bug.
- Sidenav background = body background (`--mantine-color-dark-9` in
  dark mode).
- Logo: HyperDX wordmark + logomark (SVG, currentColor for theming).

### ClickStack (yellow-first, Click UI tokens)

- Mantine `primaryColor: 'yellow'`. The yellow palette is overridden
  by the Click UI brand palette (`--palette-brand-50` …
  `--palette-brand-900`) in `clickstack/_tokens.scss`.
- Brand accent: `#faff69` (yellow `--palette-brand-300`). Used for
  links, primary outlines, accent indicators — but **never for
  chart series**, because yellow on a light background fails
  contrast and reads as "warning".
- Fonts: locked to Inter. `_app.tsx` overrides
  `userPreferences.font` to `'Inter'` when `themeName === 'clickstack'`,
  and `UserPreferencesModal.tsx` hides the font picker entirely. Don't
  add brand-conditional font logic anywhere else.
- Uses Click UI design tokens (`--click-global-color-*`) as an
  intermediate layer. Most semantic vars in `clickstack/_tokens.scss`
  reference Click UI globals rather than Mantine palette entries — keep
  this layering when extending.
- Sidenav background = body background but uses Click UI neutrals.
- Tabler icons get `stroke-width: 1.5` by default (HyperDX uses the
  Mantine default of 2). Defined as a nested rule inside the dark-mode
  selector.

### Shared between both brands

- Both define **the same set of semantic CSS vars** (see
  `semanticColorsGrouped.ts`). Adding a new var means adding it to
  **all four** SCSS blocks: hyperdx-dark, hyperdx-light,
  clickstack-dark, clickstack-light.
- The semantic chart highlight colors
  (`--color-chart-success-highlight`, `-warning-`, `-error-`) are
  **identical** across both brands. See `data_viz_colors.md` for the
  reasoning.
- The categorical chart palette has the **same hue families** in both
  brands; only slot 1 differs (green for HyperDX, blue for ClickStack).

## SSR / hydration safety

A few things that look like bugs but are intentional:

- **`_base-tokens.scss`** defines the same vars as `hyperdx/_tokens.scss`
  but **unscoped** (i.e. inside bare `[data-mantine-color-scheme='dark']`
  / `[data-mantine-color-scheme='light']` selectors). This is the
  fallback for the brief window where the theme class hasn't been added
  yet, e.g. during error boundaries or pre-hydration paints. It always
  uses HyperDX tokens. **Don't** swap it for ClickStack tokens — it's a
  "safe default" not a "guess".
- The chart CSS vars are **duplicated** inside the dark and light
  selector blocks (not factored into a shared `.theme-{brand}` block).
  This is called out in both `_tokens.scss` files. CSS specificity
  requires it: a `.theme-clickstack` rule has lower specificity than
  `.theme-clickstack[data-mantine-color-scheme='dark']`, so when
  Mantine swaps the data attribute, the unscoped chart vars would be
  *overridden by* the scheme-scoped block of the *other* mode.
  Keep them duplicated.
- `themeColor` in each favicon config is the **browser chrome color**
  (Android address bar, iOS status bar), not a semantic UI color.
- `_document.tsx` re-derives the theme class from
  `process.env.NEXT_PUBLIC_THEME` rather than importing
  `DEFAULT_THEME`. This is deliberate: `_document.tsx` runs in Node and
  importing the full theme module pulls in React components. Keep the
  resolution duplicated and minimal.
- `AppThemeProvider` updates `resolvedThemeName` in a `useEffect`
  rather than `useSyncExternalStore`. This means in dev there is a
  one-frame flash when localStorage overrides the SSR default. That's
  the agreed-on trade-off for hydration safety; don't "fix" it by
  reading localStorage during render.

## Adding things

### Adding a new semantic CSS variable

1. Pick a name following the existing convention:
   `--color-{category}-{role}[-{state}]`, e.g.
   `--color-text-link-hover`.
2. Add it to **all four** SCSS blocks:
   - `hyperdx/_tokens.scss` → `.theme-hyperdx[data-mantine-color-scheme='dark']`
   - `hyperdx/_tokens.scss` → `.theme-hyperdx[data-mantine-color-scheme='light']`
   - `clickstack/_tokens.scss` → `.theme-clickstack[data-mantine-color-scheme='dark']`
   - `clickstack/_tokens.scss` → `.theme-clickstack[data-mantine-color-scheme='light']`
3. If it should also work pre-hydration, add it to the matching mixin
   in `hyperdx/_tokens.scss` (`@mixin dark-mode-tokens` /
   `@mixin light-mode-tokens`) so it gets picked up by
   `_base-tokens.scss`.
4. Add it to the relevant group in
   `theme/semanticColorsGrouped.ts` so the storybook renders it.
5. Consume it via `var(--color-…)` in your component.

For chart-specific vars (`--color-chart-*`) there are additional steps —
see `data_viz_colors.md`.

### Adding a new brand theme (rare)

If you're adding a third brand:

1. Add the new name to the `ThemeName` union in `theme/types.ts` and the
   `name` enum inside `themeConfigSchema` in `theme/index.ts`.
2. Create `theme/themes/{newbrand}/` with the same five files
   (`index.ts`, `_tokens.scss`, `mantineTheme.ts`, `Wordmark.tsx`,
   `Logomark.tsx`).
3. Add `@use './newbrand/tokens' as newbrand-tokens;` to
   `_base-tokens.scss` if you want it to be the fallback (you almost
   certainly don't — keep HyperDX as fallback).
4. Register it in the `themes` map in `theme/index.ts`.
5. Add favicon assets under `public/favicons/{newbrand}/` matching the
   `FaviconConfig` regex (`/^\/favicons\/[a-z]+\/[a-z0-9-]+\.{svg,png}$/`).
6. Update `pages/_document.tsx` `getThemeClass()` so the new name is
   accepted (the validation list is duplicated there — keep it in sync).
7. Verify both storybook stories (`SemanticColors.stories.tsx` and
   `ChartColors.stories.tsx`) render for the new theme.
8. Update this doc and `data_viz_colors.md` with the new brand's
   conventions.

The runtime validation will refuse to load a broken `ThemeConfig` —
prefer to start by copying the hyperdx folder and tweaking incrementally.

### Adding a new color mode (e.g. high-contrast)

We don't support this today, and adding it is invasive — every SCSS
block in every theme would need to be duplicated. Don't do this without
a design owner.

## Anti-patterns

```tsx
<Box bg="dark.9" />                                              // ❌ raw Mantine palette index
<Box style={{ background: '#1a1a1a' }} />                        // ❌ hex literal
<Box style={{ background: themeName === 'clickstack' ? … : … }}/> // ❌ branching on brand for color
const c = useMantineTheme().colors.green[5];                     // ❌ reading Mantine palette for theming
import { theme as hyperdxTheme } from '@/theme/themes/hyperdx/mantineTheme'; // ❌ bypassing the registry
```

Why each is wrong:

- **Raw Mantine palette**: `dark.9` resolves differently per brand because
  ClickStack overrides `--mantine-color-dark-*` to point at its slate
  neutrals. The result *might* look right, but it skips the semantic
  layer and breaks the moment we tweak the brand mapping.
- **Hex literal**: bypasses light/dark and brand. ClickStack light users
  will see a black box on white.
- **Branching on `themeName`**: leaks brand assumptions into every
  component. If a third brand appears, every branch needs to be
  audited.
- **Reading Mantine palette directly**: same as raw Mantine palette, plus
  it forces a re-render on theme change.
- **Importing a brand's `mantineTheme` directly**: skips validation and
  the registry. Always go through `useAppTheme()`.

## Pre-merge checklist for theme-touching PRs

- [ ] No new hex/named colors in components — everything uses
      `var(--color-*)` or, for charts, the helpers from
      `data_viz_colors.md`.
- [ ] If a new semantic var was added, it exists in **all four** SCSS
      blocks (HyperDX dark + light, ClickStack dark + light) and the
      shared mixins where appropriate.
- [ ] Toggled HyperDX ↔ ClickStack (`window.__HDX_THEME.toggle()` in
      dev) — the change looks correct in both brands.
- [ ] Toggled light ↔ dark via preferences modal — change looks correct
      in both modes.
- [ ] Storybook `Design Tokens / Semantic Colors` and
      `Design Tokens / Chart Colors` still render and look correct.
- [ ] No new `themeName === 'clickstack'` branches for *colors*; brand
      branches are only for *content*, *layout*, or *feature-locked
      preferences* (e.g. font picker).
- [ ] No new `IS_CLICKHOUSE_BUILD` checks added in service of branding
      — that flag is for features, not appearance.
- [ ] `make ci-lint` and the theme tests in
      `packages/app/src/theme/__tests__/` pass.

## File reference summary

| What                                        | Where                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Theme registry + validation                 | `packages/app/src/theme/index.ts`                                                  |
| Theme types                                 | `packages/app/src/theme/types.ts`                                                  |
| Provider + hooks (`useAppTheme`, etc.)      | `packages/app/src/theme/ThemeProvider.tsx`                                         |
| Mantine wrapper (color scheme + fontFamily) | `packages/app/src/ThemeWrapper.tsx`                                                |
| SSR theme class application                 | `packages/app/pages/_document.tsx` (`getThemeClass`)                               |
| Color-mode preference + system follow       | `packages/app/src/useUserPreferences.tsx`                                          |
| Brand + font selection UI (dev gated)       | `packages/app/src/UserPreferencesModal.tsx`                                        |
| Brand-conditional font wiring               | `packages/app/pages/_app.tsx` (`AppContent`)                                       |
| HyperDX brand definition                    | `packages/app/src/theme/themes/hyperdx/{index.ts,_tokens.scss,mantineTheme.ts,…}`  |
| ClickStack brand definition                 | `packages/app/src/theme/themes/clickstack/{index.ts,_tokens.scss,mantineTheme.ts,…}` |
| SSR fallback CSS vars                       | `packages/app/src/theme/themes/_base-tokens.scss`                                  |
| Semantic var groups (storybook source)      | `packages/app/src/theme/semanticColorsGrouped.ts`                                  |
| Storybook visual references                 | `packages/app/src/theme/{SemanticColors,ChartColors}.stories.tsx`                  |
| Favicon assets                              | `packages/app/public/favicons/{hyperdx,clickstack}/`                               |
| Provider tests                              | `packages/app/src/theme/__tests__/ThemeProvider.test.tsx`                          |
| Theme validation tests                      | `packages/app/src/theme/__tests__/index.test.ts`                                   |
