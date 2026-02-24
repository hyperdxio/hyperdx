# @hyperdx/app

## 2.19.0

### Minor Changes

- 8326fc6e: feat: use optimization settings if available for use in CH

### Patch Changes

- e55b81bc: fix: Support light-mode in tagging dropdown menu
- 575779d2: Support JSON type in Surrounding Context
- b5bb69e3: fix: Improve Pie Chart implemententation
- Updated dependencies [8326fc6e]
  - @hyperdx/common-utils@0.14.0

## 2.18.0

### Minor Changes

- 051276fc: feat: pie chart now available for chart visualization
- e984e20e: feat: Theme-based branding in UI copy. Replace hardcoded "HyperDX" with the current theme display name so ClickStack deployments show "ClickStack" (e.g. "Welcome to ClickStack", page titles, error messages, help text). Adds `useBrandDisplayName()` hook in ThemeProvider.

### Patch Changes

- ec54757e: feat: Add confirm dialog when closing tile editor w/ changes
- 185d4e40: fix: Add option to display all events in search histogram bars
- fa2424da: fix: correct generated favicons for HyperDX and ClickStack
- 5988850a: fix: Prevent sampled events error when HAVING clause is specified
- 4f1da032: fix: clickstack build fixed when running same-site origin by omitting credentials from Authorization header for local mode fetch
- 38286f67: fix: searching json number property error
- Updated dependencies [051276fc]
- Updated dependencies [4f1da032]
- Updated dependencies [b676f268]
  - @hyperdx/common-utils@0.13.0

## 2.17.0

### Minor Changes

- 3171a517: feat: Add option to filter out properties with blank values in column view
- 5c895ff3: Allow overriding default connections

### Patch Changes

- 679b65d7: feat: added configuration to disable frontend otel exporter
- 30f4dfdc: chore: update ClickStack favicons to be distinct across all ClickHouse apps/sites
- 651bf99b: chore: deprecate Nextra and remove related code
- 69f0b487: design: Make service map drill-down links more obvious
- ce09b59b: feat: add static build generation
- a8aa94b0: feat: add filters to saved searches
- c3bc43ad: fix: Avoid using bodyExpression for trace sources
- 161cdcc8: fix: error trace event pattern should have red color
- Updated dependencies [a8aa94b0]
- Updated dependencies [c3bc43ad]
  - @hyperdx/common-utils@0.12.3

## 2.16.0

### Minor Changes

- 6241c388: feat: Add metrics attribute explorer in chart builder

### Patch Changes

- fa2b73ca: feat: Format byte numbers on ClickHouse page
- b6c34b13: fix: Handling non-monotonic sums
- 79356c4c: Set Button component default variant to "primary" for consistent styling across the app
- 42820f39: fix: Apply theme CSS class during SSR to prevent button styling mismatch

  Adds the theme class (e.g., `theme-hyperdx`) to the HTML element during server-side rendering in `_document.tsx`. This ensures CSS variables for button styling are correctly applied from the first render, preventing a hydration mismatch that caused primary buttons to display with Mantine's default styling instead of the custom theme styling when `NEXT_PUBLIC_THEME` was explicitly set.

- e11b3138: fix: add react-hooks-eslint-plugin and fix issues across app
- Updated dependencies [b6c34b13]
  - @hyperdx/common-utils@0.12.2

## 2.15.1

### Patch Changes

- 6cfa40a0: feat: Add support for querying nested/array columns with lucene
- 3c38272f: UI improvements for ClickStack/HyperDX:

  - Improve Sessions page empty state with enhanced Card and Stepper component for setup instructions
  - Apply consistent IBM Plex Mono font family to log tables, JSON viewer, and multi-series table charts

- Updated dependencies [6cfa40a0]
  - @hyperdx/common-utils@0.12.1

## 2.15.0

### Minor Changes

- f44923ba: feat: Add auto-detecting and creating OTel sources during onboarding

### Patch Changes

- 9f75fe2e: fix: Ensure Noisy Patterns message isn't clipped
- d89a2db2: fix: Fix side panel tab colors in ClickStack theme
- ea56d11f: chore: Change "None" aggregation label to "Custom" in charts.
- 7448508d: feat: Theme-aware UI improvements for ClickStack

  - **Chart colors**: Made chart color palette theme-aware - ClickStack uses blue as primary color, HyperDX uses green. Charts now correctly display blue bars for ClickStack theme.
  - **Semantic colors**: Updated semantic color functions (getChartColorSuccess, getChartColorWarning, getChartColorError) to be theme-aware, reading from CSS variables or falling back to theme-appropriate palettes.
  - **Info log colors**: Changed info-level logs to use primary chart color (blue for ClickStack, green for HyperDX) instead of success green.
  - **Button variants**: Made ResumeLiveTailButton variant conditional - uses 'secondary' for ClickStack theme, 'primary' for HyperDX theme.
  - **Nav styles**: Fixed collapsed navigation styles for proper alignment and spacing when nav is collapsed to 50px width.
  - **Icon stroke width**: Added custom stroke width (1.5) for Tabler icons in ClickStack theme only, providing a more refined appearance.

- Updated dependencies [f44923ba]
  - @hyperdx/common-utils@0.12.0

## 2.14.0

### Minor Changes

- 4c287b16: fix: Fix external dashboard endpoints
- 2f1a13cc: feat: Multi-theme system with HyperDX and ClickStack branding support

  ## Major Features

  ### Multi-Theme System

  - Add infrastructure for supporting multiple brand themes (HyperDX & ClickStack)
  - Theme switching available in dev/local mode via localStorage
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

- d07e30d5: Associates a logged in HyperDX user to the ClickHouse query recorded in the query log.

### Patch Changes

- 9101a993: fix: Update ConnectionForm button variant based on test connection state

  Changed the button variant in the ConnectionForm component to reflect the test connection state, using 'danger' for invalid states and 'secondary' for others. This improves user feedback during connection testing.

- f7d8b83f: Improve sidebar expand/collapse animation
- b8ab312a: chore: improve Team typing
- 08b922cd: debug: notify SourceForm error path when message is 'Required'
- 16df5024: fix: Fix tile hover state after closing edit modal
- 22f882d6: Do not trigger table search input on modals/drawers
- 7a5a5ef6: fix: Fix histogram disappearing and scrollbar issues on event patterns and search pages

  Fixes regression from PR #1598 by adding proper flex container constraints to prevent histogram from disappearing and scrollbar from cutting off 120px early.

- be4b784c: fix: Make JSON line hover visible in inline panel
- eea4fa48: fix: Prevent orphan alert when duplicating dashboard tiles
- 0dd58543: fix: Fix dashboard error when using filter on non-String column
- Updated dependencies [6aa3ac6f]
- Updated dependencies [b8ab312a]
  - @hyperdx/common-utils@0.11.1

## 2.13.0

### Minor Changes

- 94ddc7eb: Add fullscreen panel view for dashboard charts

  - Add YouTube-style fullscreen panel mode for dashboard charts
  - Add expand button to chart hover toolbar (positioned after copy button)
  - Implement 'f' keyboard shortcut to toggle fullscreen (works like YouTube)
  - Support ESC key to exit fullscreen
  - Works with all chart types: Line, Bar, Table, Number, Markdown, and Search
  - Improved modal rendering to prevent screen shake/glitching
  - Follows Mantine useHotkeys pattern for keyboard shortcuts

- 9f51920b: Add a search input that allows searching within the virtual elements on the log search page
- bc8c4eec: feat: allow applying session settings to queries

### Patch Changes

- 5b3ce9fc: refactor: Standardize Button/ActionIcon variants and add ESLint enforcement
- 1cf8cebb: feat: Support JSON Sessions
- 190c66b8: Add metric column name validation when saving dashboard tiles
- 9725a1fc: chore: Remove beta label from MVs
- ddc54e43: feat: Allow customizing zero-fill behavior
- 18222cd3: fix: Fix accuracy of ClickHouse inserts chart
- 66b1a48a: fix: Disable usePresetDashboardFilters request in local mode
- de680527: fix: Make pattern sampling query random
- 418828e8: Add better types for AI features, Fix bug that could cause page crash when generating graphs
- f39fcdac: fix: Refresh metadata after creating new connection in local mode
- 5b252211: fix: Respect date range URL params on Services dashboard
- ddc7dd04: various improvements to search result drawers and nesting logic
- 79398be7: chore: Standardize granularities
- 72d89989: Fix sessions subpanel not being closable, also fix loading indicator adding additional scrollbar to page
- db845604: fix: bypass aliasWith so that useRowWhere works correctly
- cf71a1cb: feat: Add text-brand semantic color tokens for theme flexibility
- acefcbed: fix: Fix K8s events query for JSON schema
- 3a2c33d3: feat: debounce highlighted attribute validation query
- 1d961409: fix: Set correct values when opening number format form
- 6752b3f8: fix: Filter DBTraceWaterfall events on timestamp expression
- 1ed1ebf3: feat(charts): switch to Observable categorical color palette for better accessibility and theme support
- 824a19a7: refactor(app-nav): reorganize AppNav component structure and improve maintainability
- 78423450: Add `variant` prop to table components for muted background styling in dashboard tiles
- f98fc519: perf: Query filter values from MVs
- b2089fa9: fix: Prevent dashboard error when metricName is defined for non-metric source
- 64998e0f: fix: Fix dashboard filters from Metric Tables
- cf3ebb4b: feat: Add disabled state support and Storybook stories for Button and ActionIcon components

  - Ensure all Button and ActionIcon variants use Mantine's default disabled styling for consistency
  - Add comprehensive Storybook stories including Playground, DisabledStates, and LoadingStates
  - Improve component documentation and testing capabilities

- ac3082a5: Validate column names for metrics before creating a chart
- 16036025: feat: Add HAVING filter to table charts
- bf553d68: Revert "fix: alias reference bug in processRowToWhereClause"
- 4a856173: feat: Add hasAllTokens for text index support
- 5ba7fe00: style: Rename sidenav background color tokens for clarity and update AppNav hover/focus states
- Updated dependencies [1cf8cebb]
- Updated dependencies [418828e8]
- Updated dependencies [79398be7]
- Updated dependencies [bc8c4eec]
- Updated dependencies [00854da8]
- Updated dependencies [f98fc519]
- Updated dependencies [f20fac30]
- Updated dependencies [4a856173]
  - @hyperdx/common-utils@0.11.0

## 2.12.0

### Minor Changes

- 8b5e80da: Add chart legend series filtering with click and shift-click selection
- 5dded38f: Refactor Sources components and add custom Mantine UI variants

  - Move SourceForm to Sources/ subfolder with reusable SourcesList component
  - Add primary, secondary, and danger button/action icon variants
  - Improve Storybook with font switching and component stories
  - Update ErrorBoundary styling with danger variant

### Patch Changes

- e9650e86: Fix hydration errors across a variety of pages
- ab7645de: feat: Add a minimum date to MV configuration
- 9f9629e4: fix: Increase span waterfall limit to 50 - 100k spans
- 99863885: fix: Fix missing dashboard edit icons on search tile
- 1a9362e7: Fix bug where loading saved search from another page might use default values instead
- 2c288b1e: Fix threshold on alerts not visible, fix sessions page overflow bug
- 8927f9e2: chore: bundle drain3 wasm deps
- 725dbc2f: feat: Align line/bar chart date ranges to chart granularity
- 1e6987e4: fix: Set better Chart Axis Bounds
- 158ccefa: refactor: Add ChartContainer component with toolbar
- 8213d69b: fix: Ensure displayed queries and MV indicators match queried configs
- ae12ca16: feat: Add MV granularities and infer config from SummingMergeTree
- 3b71fecb: fix: display "temporary dashboard" banner until dashboard is created
- 8172fba9: fix: Fix a couple of visual bugs in Chart titles
- 0c16a4b3: feat: Align date ranges to MV Granularity
- Updated dependencies [ab7645de]
- Updated dependencies [ebaebc14]
- Updated dependencies [725dbc2f]
- Updated dependencies [0c16a4b3]
  - @hyperdx/common-utils@0.10.2

## 2.11.0

### Minor Changes

- 39633f3a: feat: Add span event annotations to waterfall view

### Patch Changes

- 4889205a: fix: Prevent crashes on Services and ClickHouse dashboards
- 103c63cc: chore(eslint): enable @typescript-eslint/no-unsafe-type-assertion rule (warn)
- e78960f3: style: Fix style inconsistencies
- 11bd8e3d: Fix issue where select is not updating when loading saved searches
- 8584b4a4: fix: source form was not loading properly for all sources
- Updated dependencies [103c63cc]
- Updated dependencies [103c63cc]
  - @hyperdx/common-utils@0.10.1

## 2.10.0

### Minor Changes

- a5a04aa9: feat: Add materialized view support (Beta)

### Patch Changes

- 12cd6433: Improvements to Webhooks rendering (grouping, icons, etc)
- 99e7ce25: Reduce instrumentation trace events when search results shown
- 5062d80d: fix: Prevent dashboard infinite re-render
- d5181b6a: fix: Add SPAN*KIND* values to service map filters
- 21427340: Improve light mode contrast for DBRowTableIconButton by removing hardcoded gray color and text-muted-hover class
- 215b9bf7: Add prop to disable drilldown if not supported
- 6d4fc318: feat: parallelize DBSearchPage's histogram query
- 8241ffea: Make line wrapping in search page persistent
- 96f0539e: feat: Add silence alerts feature
- e0c23d4e: feat: flush chunk data as it arrives if in order
- 4ba37e55: Swap out bootstrap icons for tabler icons across app
- 80117ebf: Minor UI Improvements in Search Filters UI
- b564a369: fix: Ensure adequate SQL/Schema Preview modal height
- 50ba92ac: feat: Add custom filters to the services dashboard"
- dc846011: fix: show alert indicator for bar charts too
- b99052ad: fix: cityHash64 in sessions cast to string due to number precision issues in the browser
- 141b4969: fix: Correctly disable previous period query
- b58c52eb: fix: Fix bugs in the Services dashboard
- 19b710fb: fix: Update Request Error Rate config to use MVs
- 84d60a64: fix: Fix double value for isRootSpan facet
- 61cb9425: Performance Improvement to only run sample query when the table is visible
- ae4c8765: fix: error loading row data by multiple search panel in dashboard
- 776e3927: fix: Fix queries/minute calculation in Services Dashboard
- 6d4fc318: feat: add teamsetting for paralellizing queries when possible
- 69d9a418: feat: Filter on isRootSpan column if present
- 780279fd: feat: Save tile to dashboard from chart explorer
- 468eb924: Update some forms to work better with React 19
- Updated dependencies [ca693c0f]
- Updated dependencies [50ba92ac]
- Updated dependencies [a5a04aa9]
- Updated dependencies [b58c52eb]
  - @hyperdx/common-utils@0.10.0

## 2.9.0

### Minor Changes

- 52d27985: chore: Upgrade nextjs, react, and eslint + add react compiler
- 630592db: # Font Rendering Fix

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

### Patch Changes

- 586bcce7: feat: Add previous period comparisons to line chart
- 4503d394: improve markdown rendering after we removed bootrstrap reset styles
- c60e646e: Improve how filters are parsed on the search page
- 337be9a2: Add support for deeplinking to search page from most charts and tables
- 991bd7e6: fix: Round previous period offset to the second
- 562dd7ea: Fix minor UI issues and enhance styling across various components
- 087ff400: feat: Grouped filters for map/json types
- b7789ced: chore: deprecate unused go-parser service
- 4b1557d9: fix: Backport Services Dashboard fixes
- 237a2677: style: Fix missing AlertHistory colors
- 3f941058: fix issue with query timeout on the search page
- bacefac9: fix: Fix session page source change on submit
- 2f25ce6f: fix: laggy performance across app
- ff422206: fix: Fix Services Dashboard Database tab charts
- d7a5c43b: feat: add ability to change live tail refresh interval

  Adds a dropdown selector in the search page that allows users to configure the live tail refresh interval. Options include 1s, 2s, 4s (default), 10s, and 30s. The selected refresh frequency is persisted in the URL query parameter.

- 7c391dfb: fix: Disable useSessionId query when traceId input is undefined
- 36cf8665: fix: Don't clobber spans in trace waterfall when multiple spans have duplicate span ids
- 07392d23: feat: Add clickpy_link to clickpy trace source attributes
- f868c3ca: Add back selection ui on histogram
- 21146027: chore: remove deprecated SpanAttribute.http.scheme reference from serviceDashboard
- 70fe682b: Add clickable alert timeline chips
- 7cf4ba4d: Allow HyperDX's listen address to be overriden at runtime with the env var HYPERDX_APP_LISTEN_HOSTNAME. The default remains 0.0.0.0 .
- 3b2a8633: fix: sort on the client side in KubernetedDashboardPage
- 9da2d32f: feat: Improve filter search
- 770276a1: feat: Add waterfall span/error count summary, span tooltip status
- 59422a1a: feat: Add custom attributes for individual rows
- 7405d183: bump typescript version
- 815e6424: chore: treat missing react hook dependencies as errors
- 5b7d646f: fix: date/timepicker issue with dates in the future
- fce307c8: feat: Allow specifying persistent order by in chart table
- c8ec7fa9: fix: Hide table header when no columns are displayed
- 770276a1: feat: Add search to trace waterfall
- a9f10c5f: feat: Add highlighted attributes to overview panel
- 238c36fd: feat: Improve display of large sizes and volumes of highlighted attributes
- Updated dependencies [586bcce7]
- Updated dependencies [ea25cc5d]
- Updated dependencies [52d27985]
- Updated dependencies [b7789ced]
- Updated dependencies [ff422206]
- Updated dependencies [59422a1a]
- Updated dependencies [7405d183]
- Updated dependencies [770276a1]
  - @hyperdx/common-utils@0.9.0

## 2.8.0

### Minor Changes

- f612bf3c: feat: add support for alert auto-resolve
- 91e443f4: feat: Add service maps (beta)
- cfba5cb6: feat: Sort source dropdown alphabetically
- af6a8d0d: feat: Remove `bootstrap`, `react-bootstrap` and unused `react-bootstrap-range-slider`, adopt semantic tokens, and improve Mantine UI usage

### Patch Changes

- 99cb17c6: Add ability to edit and test webhook integrations
- 44a6a08a: Remove react-select for mantine
- 3fb5ef70: Small fix for html structure nesting issues
- 4d1eaf10: style: Fix filter color and alert icon alignment
- 78aff336: fix: Group alert histories by evaluation time
- 892e43f8: fix: Improve loading of kubernetes dashboard
- f612bf3c: feat: support incident.io integration
- f612bf3c: fix: handle group-by alert histories
- c4915d45: feat: Add custom trace-level attributes above trace waterfall
- c42a070a: fix: Fix session search behavior
- 1e39e134: Fix bug with generating search urls
- b90a0649: fix: Switch to 'all' after filters change on kubernetes dashboard page
- 8dee21c8: Improve event deltas (error states, complex values leverage ctes, etc.)
- 09f07e57: fix: Prevent incorrect dashboard side panel close
- 2faa15a0: Add title tag to app where missed (including catchall title)
- 63fcf145: fix: optimize query key for aliasMap to prevent jitter
- 2743d85b: Add ability to resize trace waterfall subpanel
- a7e150c8: feat: Improve Service Maps
- 7bb7a878: feat: Add filter for root spans
- 64b56730: feat: Format row counts (result counter and scanned row estimate) in search page
- 24bf2b41: bug fixes with relative time selection
- c5cb1d4b: fix: add json compatibility for infrastructure tab
- 44caf197: Zero-fill empty alert periods
- Updated dependencies [f612bf3c]
- Updated dependencies [f612bf3c]
- Updated dependencies [f612bf3c]
- Updated dependencies [c4915d45]
- Updated dependencies [6e628bcd]
  - @hyperdx/common-utils@0.8.0

## 2.7.1

### Patch Changes

- 93edb6f8: fix: memoize inputs to fix text input performance
- d5a38c3e: fix: Fix pattern sample query for sources with multi-column timestamp expressions
- 7b6ed70c: fix: Support custom Timestamp Columns in Surrounding Context panel
- 2162a690: feat: Optimize and fix filtering on toStartOfX primary key expressions
- 15331acb: feat: Auto-select correlated sources on k8s dashboard
- bb3539dd: improve drawer a11y
- 24b5477d: feat: allow specifying webhook request headers
- 3ee93ae9: feat: Show pinned filter values while filters are loading
- de0b4fc7: Adds "Relative Time" switch to TimePicker component (if relative time is supported by parent). When enabled, searches will work similar to Live Tail but be relative to the option selected.
- 757196f2: close modals when bluring (dates and search hints)
- ff86d400: feat: Implement query chunking for charts
- 21614b94: feat: Include displayed timestamp in default order by
- 808413f5: Ensure popovers inside the TimePicker component can be accessed
- ab7af41f: avoid hydration errors when app loads if nav is collapsed
- Updated dependencies [2162a690]
- Updated dependencies [8190ee8f]
  - @hyperdx/common-utils@0.7.2

## 2.7.0

### Minor Changes

- b806116d: feat: Add subpath configuration support

  This change allows the HyperDX frontend to be served from a subpath (e.g.,
  `/hyperdx`). It includes updated Next.js, NGINX, and Traefik configurations,
  along with documentation for the new setup.

- 730325a5: Improve SourceSchemaPreview button integration in SourceSelect and DBTableSelect components.
- dbf16827: feat: add refresh to existing preset dashboards
- eaff4929: Add toggle filters button, copy field, and per-row copy-to-clipboard for JSON data and modal URLs in RawLogTable
- 348a4044: migration: migrate to Pino for standardized and faster logging

### Patch Changes

- 13b191c8: feat: Allow selection of log and metric source on K8s dashboard
- 1ed32e43: fix issue where new lines are not persisted to url params correctly
- 35c42222: fix: Improve table key parsing
- b68a4c9b: Tweak getMapKeys to leverage one row limiting implementation
- 2d27fe27: fix: Support JSON keys in dashboard filters
- 1cda1485: Fixes scrolling in TimePicker
- 2dc0079b: feat: Sort dashboard filter options
- 5efa2ffa: feat: handle k8s metrics semantic convention updates
- 43e32aaf: fix: handle metrics semantic convention upgrade (feature gate)
- bd940f30: style: Improve dashboard filter modal UX
- 3332d5ea: Add ability to customize event deltas heat map y, count, and grouping attributes
- 6262ced8: fix: Fix crash when navigating away from chart explorer search page
- ec2ea566: Improve Support for Dynamic and JSON(<parameters>) Types
- 65872831: fix: Preserve original select from time chart event selection
- b46ae2f2: fix: Fix sidebar when selecting JSON property
- 62eddcf2: fix: Fix infinite querying on non-windowed searches
- 065cabdb: fix: Update "Copy Object" in line viewer to work with nested objects and arrays
- 05ca6ceb: Attempt to make claude code reviews less chirpy
- daffcf35: feat: Add percentages to filter values
- 5210bb86: refactor: clean up table connections
- 0cf179fa: Fixes typo in type definition
- b3448041: Add Sorting Feature to all search tables
- Updated dependencies [35c42222]
- Updated dependencies [b68a4c9b]
- Updated dependencies [5efa2ffa]
- Updated dependencies [43e32aaf]
- Updated dependencies [3c8f3b54]
- Updated dependencies [65872831]
- Updated dependencies [b46ae2f2]
- Updated dependencies [2f49f9be]
- Updated dependencies [daffcf35]
- Updated dependencies [5210bb86]
  - @hyperdx/common-utils@0.7.1

## 2.6.0

### Minor Changes

- 8a24c32a: Feat: add highlight animation for recently moved filter checkboxes
- 6c8efbcb: feat: Add persistent dashboard filters
- 54d30b92: feat: Add support for filter by parsed JSON string

### Patch Changes

- fa25a0c9: Improve search error isolation
- 8673f967: fix: json getKeyValues (useful for autocomplete)
- 69a2a6af: fix: 'Around a time' duration update in TimePicker
- ea5d2921: Improve memory efficiency in high row cound envs
- 24314a96: add dashboard import/export functionality
- 8f06ce7b: perf: add prelimit CTE to getMapKeys query + store clickhouse settings in shared cache
- e053c490: chore: Customize user-agent for Alerts ClickHouse client
- 7837a621: fix: Multiline support for WHERE Input boxes
- Updated dependencies [8673f967]
- Updated dependencies [4ff55c0e]
- Updated dependencies [816f90a3]
- Updated dependencies [24314a96]
- Updated dependencies [8f06ce7b]
- Updated dependencies [e053c490]
- Updated dependencies [6c8efbcb]
  - @hyperdx/common-utils@0.7.0

## 2.5.0

### Minor Changes

- 5a44953e: feat: Add new none aggregation function to allow fully user defined aggregations in SQL
- 0cf8556d: feat: Allow chart series to be reordered
- 970c0027: Fix: improve the discoverability of inline item expansion within the search table

### Patch Changes

- 7a058059: Reusable DBSqlRowTableWithSideBar Component
- 2c44ef98: style: Update icon used to show source schema
- 0d9f3fe0: fix: Always enable query analyzer to fix compatibility issues with old ClickHouse versions.
- 21f1aa75: fix: filter values for json casted to string
- 825452fe: refactor: Decouple alerts processing from Mongo
- 1d79980e: fix: Fix ascending order in windowed searches
- 0183483a: feat: Add source schema previews
- Updated dependencies [0d9f3fe0]
- Updated dependencies [3d82583f]
- Updated dependencies [5a44953e]
- Updated dependencies [1d79980e]
  - @hyperdx/common-utils@0.6.0

## 2.4.0

### Minor Changes

- deff04f6: Adds expandable log lines to search results tables
- fa45875d: Add delta() function for gauge metrics

### Patch Changes

- c48f4181: Add accordion functionality to filter groups, changed how the system prioritizes which filters are open by default, added new sort logic for prioritizing certain filters.
- 45e8e1b6: fix: Update tsconfigs to resolve IDE type errors
- d938b4a4: feat: Improve Slack Webhook validation
- 5c88c463: fix bug where reading value when server is offline could throw client error
- cd5cc7d2: fix: Fixed trace table source inference to correctly infer span events column
- Updated dependencies [45e8e1b6]
- Updated dependencies [fa45875d]
- Updated dependencies [d938b4a4]
- Updated dependencies [92224d65]
- Updated dependencies [e7b590cc]
  - @hyperdx/common-utils@0.5.0

## 2.3.0

### Minor Changes

- 25f77aa7: added team level queryTimeout to ClickHouse client
- 64eb638b: feat: Improve search speed by chunking long time range searches into smaller incremental search windows.

### Patch Changes

- c691e948: Improve the rendering of autocomplete suggestions in a modal context
- d6f8058e: - deprecate unused packages/api/src/clickhouse
  - deprecate unused route /datasources
  - introduce getJSNativeCreateClient in common-utils
  - uninstall @clickhouse/client in api package
  - uninstall @clickhouse/client + @clickhouse/client-web in app package
  - bump @clickhouse/client in common-utils package to v1.12.1
- fb66126e: fix: remove play button and time picker from markdown tab
- 88f3cafb: fix: Prevent empty order by set in search page for certain sort/primary keys
- 784014b6: fix: broke out line break icon from HyperJsonMenu
- 9c4c5f49: feat: support toUnixTimestamp style timestamps in ORDER BY
- aacd24dd: refactor: decouple clickhouse client into browser.ts and node.ts
- 52483f6a: feat: enable filters for json columns
- aacd24dd: bump: default request_timeout to 1hr
- 5e4047a9: feat: add generated SQL modal to the search page
- 042e3595: Resolved overflow issue and enhanced color contrast in nav bar profile section.
- a714412d: Improve live tail logic to not fetch if the page isn't visible.
- b6787d56: fix: format numbers on dashboards only for the queried column, not groupBy columns
- ecb20c84: feat: remove useless session source fields
- Updated dependencies [25f77aa7]
- Updated dependencies [d6f8058e]
- Updated dependencies [aacd24dd]
- Updated dependencies [52483f6a]
- Updated dependencies [aacd24dd]
- Updated dependencies [3f2d4270]
- Updated dependencies [ecb20c84]
  - @hyperdx/common-utils@0.4.0

## 2.2.2

### Patch Changes

- 56fd856d: fix: otelcol process in aio build
- Updated dependencies [56fd856d]
- Updated dependencies [0f242558]
  - @hyperdx/common-utils@0.3.2

## 2.2.1

### Patch Changes

- d29e2bc: fix: handle the case when `CUSTOM_OTELCOL_CONFIG_FILE` is not specified
- 5eeee5c: change app's docs links to ClickStack docs
- Updated dependencies [d29e2bc]
  - @hyperdx/common-utils@0.3.1

## 2.2.0

### Minor Changes

- c0b188c: Track the user id who created alerts and display the information in the UI.
- 6dd6165: feat: Display original query to error messages in search page

### Patch Changes

- 5ad1455: feat: centralize the default orderBy and optimize it for diverse table structures
- 823566f: chore: show display switcher on dashboard page
- 4c459dc: handle escaped string search correctly
- 35fe9cf: fix default order by generated for advanced table sorting keys
- 5a59d32: Upgraded NX from version 16.8.1 to 21.3.11
- 9cd9bfb: fix: Properly fetch tables in source edit dropdown when new connection is selected
- Updated dependencies [6dd6165]
- Updated dependencies [5a59d32]
  - @hyperdx/common-utils@0.3.0

## 2.1.2

### Patch Changes

- 39cde41: fix: k8s event property mappings
- b568b00: feat: introduce team 'clickhouse-settings' endpoint + metadataMaxRowsToRead setting
- 86115fa: feat: Add click + sidepanel support to items within surrounding context
- 7cd1d2a: fix: endless rerenders caused by Date.now() in a component
- ba86b0c: fix: Set default source in dropdown if one does not exist
- Updated dependencies [39cde41]
- Updated dependencies [b568b00]
  - @hyperdx/common-utils@0.2.9

## 2.1.1

### Patch Changes

- 1dc1c82: feat: add team setting to disable field metadata queries in app
- dc4a32c: feat: add text wrap to tables
- eed38e8: bump node version to 22.16.0
- 3bb11af: fix: Allow users to disable field fetching
- Updated dependencies [eed38e8]
  - @hyperdx/common-utils@0.2.8

## 2.1.0

### Minor Changes

- bb37520: Correlated source field links are bidirectional by default and no link exists.

### Patch Changes

- 4ce81d4: fix: handle Nullable + Tuple type column + decouple useRowWhere
- 6c13403: fix: use '--kill-others-on-fail' to prevent processes from terminating when RUN_SCHEDULED_TASKS_EXTERNALLY is enabled
- 61c79a1: fix: Ensure percentile aggregations on histograms don't create invalid SQL queries due to improperly escaped aliases.
- Updated dependencies [4ce81d4]
- Updated dependencies [61c79a1]
  - @hyperdx/common-utils@0.2.7

## 2.0.6

### Patch Changes

- 33fc071: feat: Allow users to define custom column aliases for charts
- b9ad3bd: fix: Limit source selector to only display the supported types in search, sessions and dashboards
- 10abadd: feat: Add verbose time range used for search in results table
- 40d0439: feat: Allow pinning a field in the filter panel
- 4581a68: fix: queries firing before having a valid table or connection id
- Updated dependencies [33fc071]
  - @hyperdx/common-utils@0.2.6

## 2.0.5

### Patch Changes

- 973b9e8: feat: Add any aggFn support, fix select field input not showing up
- 844f74c: fix: validate name for saved searches
- f7eb1ef: feat: configurable search row limit
- Updated dependencies [973b9e8]
  - @hyperdx/common-utils@0.2.5

## 2.0.4

### Patch Changes

- 52ca182: feat: Add ClickHouse JSON Type Support
- Updated dependencies [52ca182]
  - @hyperdx/common-utils@0.2.4

## 2.0.3

### Patch Changes

- b75d7c0: feat: add robust source form validation and error reporting
- a06c8cd: feat: Add download csv functionality to search tables
- 93e36b5: fix: remove id from post for connection creation endpoint
- Updated dependencies [b75d7c0]
- Updated dependencies [93e36b5]
  - @hyperdx/common-utils@0.2.3

## 2.0.2

### Patch Changes

- d1f4184: perf: improve performance on chart page and search page
- 8ab3b42: fix: fix demo instances for those with stale sources
- d1fc0c7: fix: change NEXT_PUBLIC_SERVER_URL to SERVER_URL
- eb9d009: feat: DBRowSidePanel global error boundary
- 73aff77: feat: Improve source editing UX
- 31e22dc: feat: introduce clickhouse db init script
- 2063774: perf: build next app in standalone mode to cut down images size
- 86fa929: Removed duplicate type definition.
- Updated dependencies [31e22dc]
- Updated dependencies [2063774]
  - @hyperdx/common-utils@0.2.2

## 2.0.1

### Patch Changes

- ab3b5cb: perf: merge api + app packages to dedupe node_modules
- ab387e1: fix: missing types in app build
- fce5ee5: feat: add load more to features and improve querying
- dfdb2d7: Better loading state for events patterns table
- 3eeb530: fix: date range undefined error causing issue loading keyvals for autocomplete
- 8874648: fix: Pollyfill crypto.randomUUID
- 43edac8: chore: bump @hyperdx/node-opentelemetry to v0.8.2
- Updated dependencies [ab3b5cb]
- Updated dependencies [ab387e1]
- Updated dependencies [fce5ee5]
  - @hyperdx/common-utils@0.2.1

## 2.0.0

### Major Changes

- 3fb3169: bumps to v2 beta

### Minor Changes

- 759da7a: Support multiple OTEL metric types in source configuration setup.
- 9579251: Stores the collapse vs expand status of the side navigation in local storage so it's carried across browser windows/sessions.
- 57a6bc3: feat: BETA metrics support (sum + gauge)

### Patch Changes

- 56e39dc: 36c3edc fix: remove several source change forms throughout the log drawer
- c60b975: chore: bump node to v22.16.0
- ab617c1: feat: support multiseries metrics chart
- 7de8916: Removes trailing slash for connection urls
- 3be7f4d: fix: input does not overlap with language select button anymore
- d176b54: fix: chartpage querying too on every keystroke after initial query
- 459267a: feat: introduce session table model form
- fe8ed22: fix: color display on search page for traces
- b3f3151: Allow to create Slack Webhooks from Team Settings page
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- 321e24f: fix: alerting time range filtering bug
- 092a292: fix: autocomplete for key-values complete for v2 lucene
- a6fd5e3: feat: introduce k8s preset dashboard
- 2f626e1: fix: metric name filtering for some metadata
- cfdd523: feat: clickhouse queries are by default conducted through the clickhouse library via POST request. localMode still uses GET for CORS purposes
- 6dc6989: feat: Automatically use last used source when loading search page
- a9dfa14: Added support to CTE rendering where you can now specify a CTE using a full chart config object instance. This CTE capability is then used to avoid the URI too long error for delta event queries.
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- 5a10ae1: fix: delete huge z-value for tooltip
- f5e9a07: chore: bump node version to v22
- b16c8e1: feat: compute charts ratio
- 6864836: fix: don't show ellipses on search when query is in-flight
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- 08009ac: feat: add saved filters for searches
- 92a4800: feat: move rrweb event fetching to the client instead of an api route
- b99236d: fix: autocomplete options for dashboard page
- 43a9ca1: adopt clickhouse-js for all client side queries
- b690db8: Introduce event panel overview tab
- 7f0b397: feat: queryChartConfig method + events chart ratio
- 5db2767: Fixed CI linting and UI release task.
- 000458d: chore: GA v2
- 84a9119: fix: Session replay intermittently showing "No replay available for this session"
- 4514f2c: Remove connection health hook - too noisy
- 8d534da: fixed ui state on session panel to be inline with ui
- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)
- 2580ddd: chore: bump next to v13.5.10
- db761ba: fix: remove originalWhere tag from view. not used anyways
- 184402d: fix: use quote for aliases for sql compatibility
- 5044083: Session Replay tab for traces is disabled unless the source is configured with a sessionId
- 8c95b9e: Add search history
- a762203: fix: metadata getAllKeyValues query key scoped to table now
- cd0e4fd: fix: correct handling of gauge metrics in renderChartConfig
- b4b5f6b: style: remove unused routes/components + clickhouse utils (api)
- 1211386: add severitytext coloring to event patterns
- 6dafb87: fix: View Events not shown for multiple series; grabs where clause when single series
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- decd622: fix: k8s dashboard uptime metrics + warning k8s event body
- e884d85: fix: metrics > logs correlation flow
- e5a210a: feat: support search on multi implicit fields (BETA)
- Updated dependencies [50ce38f]
- Updated dependencies [79fe30f]
- Updated dependencies [e935bb6]
- Updated dependencies [8acc725]
- Updated dependencies [2e350e2]
- Updated dependencies [321e24f]
- Updated dependencies [092a292]
- Updated dependencies [a6fd5e3]
- Updated dependencies [2f626e1]
- Updated dependencies [cfdd523]
- Updated dependencies [9c5c239]
- Updated dependencies [7d2cfcf]
- Updated dependencies [a9dfa14]
- Updated dependencies [fa7875c]
- Updated dependencies [b16c8e1]
- Updated dependencies [c50c42d]
- Updated dependencies [86465a2]
- Updated dependencies [e002c2f]
- Updated dependencies [b51e39c]
- Updated dependencies [759da7a]
- Updated dependencies [b9f7d32]
- Updated dependencies [92a4800]
- Updated dependencies [eaa6bfa]
- Updated dependencies [e80630c]
- Updated dependencies [4865ce7]
- Updated dependencies [29e8f37]
- Updated dependencies [43a9ca1]
- Updated dependencies [7f0b397]
- Updated dependencies [bd9dc18]
- Updated dependencies [5db2767]
- Updated dependencies [414ff92]
- Updated dependencies [000458d]
- Updated dependencies [0cf5358]
- Updated dependencies [99b60d5]
- Updated dependencies [931d738]
- Updated dependencies [57a6bc3]
- Updated dependencies [184402d]
- Updated dependencies [a762203]
- Updated dependencies [cd0e4fd]
- Updated dependencies [e7262d1]
- Updated dependencies [321e24f]
- Updated dependencies [96b8c50]
- Updated dependencies [e884d85]
- Updated dependencies [e5a210a]
  - @hyperdx/common-utils@0.2.0

## 2.0.0-beta.17

### Patch Changes

- c60b975: chore: bump node to v22.16.0
- d176b54: fix: chartpage querying too on every keystroke after initial query
- fe8ed22: fix: color display on search page for traces
- 321e24f: fix: alerting time range filtering bug
- fa7875c: feat: add summary and exponential histogram metrics to the source form and database storage
- 86465a2: fix: map CLICKHOUSE_SERVER_ENDPOINT to otelcol ch exporter 'endpoint' field
- 43a9ca1: adopt clickhouse-js for all client side queries
- 84a9119: fix: Session replay intermittently showing "No replay available for this session"
- 8d534da: fixed ui state on session panel to be inline with ui
- a762203: fix: metadata getAllKeyValues query key scoped to table now
- 1211386: add severitytext coloring to event patterns
- e7262d1: feat: introduce all-one-one (auth vs noauth) multi-stage build
- Updated dependencies [e935bb6]
- Updated dependencies [321e24f]
- Updated dependencies [7d2cfcf]
- Updated dependencies [fa7875c]
- Updated dependencies [86465a2]
- Updated dependencies [b51e39c]
- Updated dependencies [43a9ca1]
- Updated dependencies [0cf5358]
- Updated dependencies [a762203]
- Updated dependencies [e7262d1]
- Updated dependencies [321e24f]
- Updated dependencies [96b8c50]
  - @hyperdx/common-utils@0.2.0-beta.6

## 2.0.0-beta.16

### Patch Changes

- 931d738: fix: bugs with showing non otel spans (ex. clickhouse opentelemetry span logs)
- Updated dependencies [931d738]
  - @hyperdx/common-utils@0.2.0-beta.5

## 2.0.0-beta.15

### Patch Changes

- 7de8916: Removes trailing slash for connection urls
- cfdd523: feat: clickhouse queries are by default conducted through the clickhouse library via POST request. localMode still uses GET for CORS purposes
- 6dc6989: feat: Automatically use last used source when loading search page
- 92a4800: feat: move rrweb event fetching to the client instead of an api route
- 7f0b397: feat: queryChartConfig method + events chart ratio
- b4b5f6b: style: remove unused routes/components + clickhouse utils (api)
- Updated dependencies [79fe30f]
- Updated dependencies [cfdd523]
- Updated dependencies [92a4800]
- Updated dependencies [7f0b397]
  - @hyperdx/common-utils@0.2.0-beta.4

## 2.0.0-beta.14

### Patch Changes

- 56e39dc: 36c3edc fix: remove several source change forms throughout the log drawer
- 092a292: fix: autocomplete for key-values complete for v2 lucene
- 2f626e1: fix: metric name filtering for some metadata
- f5e9a07: chore: bump node version to v22
- b16c8e1: feat: compute charts ratio
- 08009ac: feat: add saved filters for searches
- db761ba: fix: remove originalWhere tag from view. not used anyways
- 8c95b9e: Add search history
- Updated dependencies [092a292]
- Updated dependencies [2f626e1]
- Updated dependencies [b16c8e1]
- Updated dependencies [4865ce7]
  - @hyperdx/common-utils@0.2.0-beta.3

## 2.0.0-beta.13

### Minor Changes

- 9579251: Stores the collapse vs expand status of the side navigation in local storage so it's carried across browser windows/sessions.

### Patch Changes

- 3be7f4d: fix: input does not overlap with language select button anymore
- 2e350e2: feat: implement logs > metrics correlation flow + introduce convertV1ChartConfigToV2
- a6fd5e3: feat: introduce k8s preset dashboard
- a9dfa14: Added support to CTE rendering where you can now specify a CTE using a full chart config object instance. This CTE capability is then used to avoid the URI too long error for delta event queries.
- 5a10ae1: fix: delete huge z-value for tooltip
- 6864836: fix: don't show ellipses on search when query is in-flight
- b99236d: fix: autocomplete options for dashboard page
- 5db2767: Fixed CI linting and UI release task.
- 2580ddd: chore: bump next to v13.5.10
- 5044083: Session Replay tab for traces is disabled unless the source is configured with a sessionId
- 6dafb87: fix: View Events not shown for multiple series; grabs where clause when single series
- decd622: fix: k8s dashboard uptime metrics + warning k8s event body
- e884d85: fix: metrics > logs correlation flow
- e5a210a: feat: support search on multi implicit fields (BETA)
- Updated dependencies [50ce38f]
- Updated dependencies [2e350e2]
- Updated dependencies [a6fd5e3]
- Updated dependencies [a9dfa14]
- Updated dependencies [e002c2f]
- Updated dependencies [b9f7d32]
- Updated dependencies [eaa6bfa]
- Updated dependencies [bd9dc18]
- Updated dependencies [5db2767]
- Updated dependencies [414ff92]
- Updated dependencies [e884d85]
- Updated dependencies [e5a210a]
  - @hyperdx/common-utils@0.2.0-beta.2

## 2.0.0-beta.12

### Patch Changes

- fix: use quote for aliases for sql compatibility
- Updated dependencies
  - @hyperdx/common-utils@0.2.0-beta.1

## 2.0.0-beta.11

### Minor Changes

- 759da7a: Support multiple OTEL metric types in source configuration setup.
- 57a6bc3: feat: BETA metrics support (sum + gauge)

### Patch Changes

- ab617c1: feat: support multiseries metrics chart
- 4514f2c: Remove connection health hook - too noisy
- cd0e4fd: fix: correct handling of gauge metrics in renderChartConfig
- Updated dependencies [8acc725]
- Updated dependencies [9c5c239]
- Updated dependencies [c50c42d]
- Updated dependencies [759da7a]
- Updated dependencies [e80630c]
- Updated dependencies [29e8f37]
- Updated dependencies [99b60d5]
- Updated dependencies [57a6bc3]
- Updated dependencies [cd0e4fd]
  - @hyperdx/common-utils@0.2.0-beta.0

## 2.0.0-beta.10

### Patch Changes

- 459267a: feat: introduce session table model form

## 2.0.0-beta.0

### Major Changes

- bumps to v2 beta

### Patch Changes

- b3f3151: Allow to create Slack Webhooks from Team Settings page
- b690db8: Introduce event panel overview tab

## 1.9.0

### Minor Changes

- 2488882: Allow to filter search results by event type (log or span)
- 1751b2e: Propogate isUTC and clock settings (12h/24h) across the app

### Patch Changes

- 4176710: autofocus on field select after setting a non-count aggfn
- e26a6d2: Add User Preferences modal
- 6d99e3b: New performant session replay playbar component
- ebd3f25: Reassign save search shortcut for Arc to CMD+SHIFT+S
- 25faa4d: chore: bump HyperDX SDKs (node-opentelemetry v0.8.0 + browser 0.21.0)
- ded8a77: fix: logtable scroll with highlighted line id
- 4af6802: chore: Remove unused dependencies
- 9c4f741: fix: threshold def of presence alert in alerts page
- 3b29721: Render JSON network body in a JSON viewer
- 3260f08: Allow to share open log in search dashboard tile
- da866be: fix: revisit doesExceedThreshold logic
- b192366: chore: bump node to v18.20.3
- 148c92b: perf: remove redundant otel-logs fields (timestamp + spanID +
  traceID)
- 47b758a: Confirm leaving Dashboard with unsaved changes
- 79d4f92: Hide HyperJson buttons when selecting value

## 1.8.0

### Minor Changes

- 4d6fb8f: feat: GA service health dashboard + metrics alert
- 0e365bf: this change enables generic webhooks. no existing webhook behavior
  will be impacted by this change.
- 4d6fb8f: feat: GA k8s dashboard / metrics side panel

### Patch Changes

- eefe597: Show client sessions with no user interactions but has recording by
  default
- b454003: feat: introduce conditional alert routing helper #is_match
- 05517dc: LogViewer: better JSON parsing and other tweaks
- d3e270a: chore: bump vector to v0.37.0
- ec95ef0: Add skip forward/back 15s buttons on session replay
- 2c61276: Allow exporting table chart results as CSV
- bc1e84b: Allow to interact with page while log side panel is open
- ab96e7c: Update Team Page layout and styling

## 1.7.0

### Minor Changes

- 396468c: fix: Use nuqs for ChartPage url query params

### Patch Changes

- dba8a43: Allow to drag and drop saved searches and dashhoards between groups
- 95ccfa1: Add multi-series line/table charts as well as histogram/number charts
  to the chart explorer.
- 095ec0e: fix: histogram AggFn values to be only valid ones (UI)
- 41d80de: feat: parse legacy k8s v1 cluster events
- f9521a5: Upgrade to React 18 and Next 13
- b87c4d7: fix: dense rank should be computed base on rank value and group
  (multi-series chart)
- 95f5041: Minor UI fixes
- a49726e: fix: cache the result conditionally (SimpleCache)
- b83e51f: refactor + perf: decouple and performance opt metrics tags endpoints

## 1.6.0

### Minor Changes

- ac667cd: Add Spotlight

### Patch Changes

- 82640b0: feat: implement histogram linear interpolation quantile function
- 8de2c5c: fix: handle py span ids
- 5d02cc3: Group saved searches and dashboards by tag
- 8de2c5c: feat: parse lambda json message
- 8919179: fix: Fixed parsing && and || operators in queries correctly
- cbdbe72: AppNav improvements
- 6321d1f: feat: support jk key bindings (to move through events)
- e92bf4f: fix: convert fixed minute unit granularity to Granularity enum
- 4a6db40: refactor: rename bulkInsertTeamLogStream to bulkInsertLogStream
- 8de2c5c: feat: add new k8s.pod.status_phase metrics
- 499c537: style: inject ingestor url (otel config file) + aggregator/go-parser
  url (ingestor config file) through env vars
- 8e536e1: chore: bump vector to v0.35.0

## 1.5.0

### Minor Changes

- a0dc1b5: Breaking Search Syntax Change: Backslashes will be treated as an
  escape character for a double quotes (ex. message:"\"" will search for the
  double quote character). Two backslashes will be treated as a backslash
  literal (ex. message:\\ will search for the backslash literal)

### Patch Changes

- b04ee14: feat: support multi group-bys in event series query
- f4360ed: feat: support count per sec/min/hr aggregation functions
- 7bc4cd3: feat: add last_value agg function
- d5fcb57: feat: introduce go-parser service
- 2910461: Bug fix: Restore dashboard filters, use correct field lookup for
  metrics, and remove extra log property type mapping fetches.
- 3c29bcf: feat: display hyperdx version at the bottom of app nav bar
- f618e02: Add CPU and Mem charts to Infra dashboard (with mock api)
- 4ee544c: Fix: Don't crash line chart when rendering numerical group values
- 725d7b7: 🔔 Introduces new alerts management page
- 9e617ed: ci: setup aggregator int tests
- 5f05081: feat: api to pull service + k8s attrs linkings
- dc88a59: fix: add db.normalized_statement default value
- ea9acde: Add Pods table to Infra dashboard
- 3e885bf: fix: move span k8s tags to root
- bfb08f8: perf: add index for pulling alert histories (GET alerts endpoint)
- 1b4607b: fix: services endpoint should return empty array if no custom fields
  found
- 8815eff: Placeholder page for Service Dashboard
- 08b06fa: Hide appnav banner when collapsed
- 95ddbb8: fix: services endpoint bug (missing log lines results in no matches)
- 76d7d73: fix: GET alerts endpoint

## 1.4.0

### Minor Changes

- 24afb09: Introduce Mantine.dev v6 Component Library
- 3b8effe: Add specifying multiple series of charts for time/line charts and
  tables in dashboard (ex. min, max, avg all in one chart).
- 60ee49a: Overhaul Properties viewer

### Patch Changes

- 9dc7750: fix: extend level inference scanning range
- 6d3cdae: Fix table chart link query formatting
- f65dd9b: Loading and error states for metrics dropdown
- af70f7d: Link Infrastructure Metrics with Events
- 8d1a949: perf: disable metrics property type mapping caching
- 423fc22: perf + feat: introduce SimpleCache and specify getMetricsTags time
  range
- 5e37a94: Allow to customize number formats in dashboard charts
- 807736c: Fix Headers parsing in Log Details
- 5b3b256: Show save badge in Dashboard page
- 72164a6: Limit Line Chart legend items
- 70f5fc4: Alerts page styling
- 58d928c: feat: transform k8s event semantic conventions
- 8159a01: Add K8s event tags
- ea20a79: Update Line Chart tooltip styling
- df7cfdf: Add new Legend renderer to MultiSeries chart
- b8133eb: feat: allow users to specify 'service.name' attr (flyio)
- 6efca13: Use Popover instead of Tooltip for line chart overflow

## 1.3.0

### Minor Changes

- ff38d75: feat: extract and ingest more metrics context (aggregation
  temporality, unit and monotonicity)
- 6f2c75e: refactor: split metrics chart endpoint `name` query param into `type`
  and `name` params (changing an internal API) feat: add validation for metrics
  chart endpoint using zod
- 8c8c476: feat: add is_delta + is_monotonic fields to metric_stream table
  (REQUIRES DB MIGRATION)
- 20b1f17: feat: external api v1 route (REQUIRES db migration) + Mongo DB
  migration script
- 9c2e279: feat: Log Side Panel styling
- e8c26d8: feat: time format ui addition

### Patch Changes

- ddd4867: Set up Storybook
- ddd4867: Sentry exceptions ui improvements
- 3a93196: Fix Sentry exception rendering error in side panel, add Sentry SDK to
  API server.
- a40faf1: Allow to set alerts for metric charts on development env
- f205ed5: feat: Add Sentry Integration section to Team Settings
- 2be709c: Revert adding Storybook
- 8c8c476: feat: setup clickhouse migration tool
- 77c1019: Show chart alert state (OK and ALERT)
- 4c0617e: Fix: Vertically resize session replayer
- 7784921: Fix: Don't crash session replay player when playback timestamp is not
  a valid date
- 242d8cc: Show custom actions in Session Replay events panel
- 713537d: Click on Table Tile to view all events
- 58a19fd: Set up ESLint rule for sorting imports
- abe3b12: Log Side Panel: exceptions ui improvements

## 1.2.0

### Minor Changes

- fe41b15: feat: Add dashboard delete confirmations and duplicate chart button
- bbda669: Chart alerts: add schemas and read path
- bf8af29: feat: Toggle columns from LogSidePanel
- 04f82d7: LogTable and LogSidePanel UI tweaks
- 0824ae7: API: Add support for chart alerts
- b1a537d: feat(register): password confirmation
- 8443a08: feat: implement CHART source alert (scheduled task)
- 283f32a: Chart alerts: connect UI to API
- 7d636f2: feat: enhanced registration form validation

### Patch Changes

- 9a72b85: fix: getLogBatchGroupedByBody missing return bug (regression)
- 956e5b5: chore: bump vector to v0.34.0
- 2fcd167: Chart alerts: Add UI to chart builder
- 640a5ba: fix: Chart alert default interval
- e904ec3: Refactor: Extract shared alert logic into a separate component

## 1.1.4

### Patch Changes

- 8cb0eac: Add rate function for sum metrics
- 4d24bfa: Add new version of the useTimeQuery hook along with a testing suite
- 8591aee: fix: control otel related services logs telemetry using
  HYPERDX_LOG_LEVEL

## 1.1.3

### Patch Changes

- 389bb3a: feat: support HYPERDX_LOG_LEVEL env var
- e106b75: style(ui): improve duration column representation
- 1ec122c: fix: aggregator errors handler status code
- 40ba7bb: enhancement - Persist log table column sizes to local storage

## 1.1.2

### Patch Changes

- bd37a5e: Filter out empty session replays from session replay search, add
  email filter to session replay UI
- 5d005f7: chore: bump @hyperdx/node-opentelemetry + @hyperdx/browser to latest
- 8b103f3: fix(app): negative duration in search

  Duration column in the search interface displayed negative numbers when only a
  timestamp was present. This fix changes the behavior to display "N/A" for such
  cases, clarifying that the duration is not applicable rather than displaying a
  misleading negative number.

- 911c02a: feat(app): enable cursor in session player
- 593c4ca: refactor: set output datetime format on the client side

## 1.1.1

### Patch Changes

- chore: bump @hyperdx/node-logger + @hyperdx/node-opentelemetry

## 1.1.0

### Minor Changes

- 914d49a: feat: introduce usage-stats service
