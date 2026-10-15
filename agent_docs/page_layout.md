# Page layout and headers

HyperDX app pages share a sticky top header bar and a scrollable content region below it. Use the shared layout primitives so titles, controls, and spacing stay consistent across Search, list pages, and tool pages (Service Map, Kubernetes, Chart Explorer).

## Components

| Component | Path | Use when |
|-----------|------|----------|
| `PageHeader` | `packages/app/src/components/PageHeader.tsx` | You only need the header bar (page already has its own content wrapper). |
| `PageLayout` | `packages/app/src/components/PageLayout.tsx` | You want header + flex content column in one wrapper (recommended for new pages). |

Both live next to `withAppNav` in `packages/app/src/layout.tsx`, which wraps pages with the left nav and scroll container.

## PageHeader API

```tsx
<PageHeader title="Alerts" />

{/* Sticky bar has inputs: no `title` — pass breadcrumbs into the header */}
<PageHeader
  breadcrumbs={<Breadcrumbs>...</Breadcrumbs>}
  leading={<SourceSelectControlled ... />}
  actions={<TimePicker ... />}
/>

<PageHeader>
  {/* Custom title row, e.g. editable team name on Team settings */}
</PageHeader>
```

| Prop | Purpose |
|------|---------|
| `title` | Plain page title (`<h1>`). **Use only when the sticky bar has no inputs** (list/settings pages). If the bar has pickers, search, sliders, or Run, omit `title` and use **`breadcrumbs`** (or rely on nav + document title only). |
| `breadcrumbs` | Location trail **inside the sticky header**, rendered above the toolbar when `leading` / `actions` are set. Use Mantine `Breadcrumbs` (e.g. `Dashboards` → current page). Do not duplicate the same text as `title`. |
| `leading` | Left cluster: source picker, badges, or other controls. When inputs are present, **do not** pair with `title` for the same page name. |
| `actions` | Right-aligned cluster: time range, Run/Save, sampling, refresh. |
| `children` | Full custom header when slots are not enough. Do not combine with `title` / `leading` / `actions` / `breadcrumbs` unless you use the breadcrumbs-only branch. |
| `growing` | Opt in to block padding that only shows once the toolbar outgrows `min-height`. Sessions uses this for its multi-line search; title-only pages omit it. |

Header styling is defined in `PageHeader.module.scss`: sticky top, bottom border, horizontal padding `var(--mantine-spacing-sm)` (same as Search `px="sm"`). Single-row headers keep `min-height: 60px`; stacked header (breadcrumbs + toolbar) grows with content. Pass `growing` when the toolbar can outgrow that min-height (Sessions' multi-line search) so block padding appears only once the row is taller than the bar.

## PageLayout API

```tsx
<PageLayout
  data-testid="service-map-page"
  breadcrumbs={<Breadcrumbs>...</Breadcrumbs>}
  leading={sourceSelect}
  actions={headerActions}
  fillViewport
  content={<ServiceMap ... />}
/>
```

| Prop | Purpose |
|------|---------|
| `title`, `leading`, `actions`, `breadcrumbs`, `children` | Forwarded to `PageHeader` (same rules as above). |
| `header` | Replace the default `PageHeader` entirely. |
| `content` | Main page body below the header (required). |
| `fillViewport` | Set `height: 100vh` on the page root for full-height canvases (maps, charts). |
| `contentClassName` | Extra class on the content region (e.g. padding). |

## When to use which pattern

### List / settings pages (Alerts, Dashboards, Saved Searches, Team)

- Use `PageHeader` at the top of the page.
- Put filters, tables, and tabs in a `Container` below the header (see `AlertsPage.tsx`, `DashboardsListPage.tsx`).
- Simple title-only pages: `<PageHeader title="Dashboards" />` — **only** when the header row has **no** inputs.

### Tool / canvas pages (Service Map, Kubernetes, Clickhouse, Chart Explorer)

- Prefer `PageLayout` with `fillViewport` when the main UI should fill remaining height.
- Put **global** controls in `actions` (time picker, sampling, Run)—not inside the canvas.
- Put **context** controls in `leading` (source picker, environment).
- **If the sticky header row includes any inputs** (selectors, sliders, search, time range, Run): **omit `title`**. Express location with the **`breadcrumbs` prop** on `PageLayout` / `PageHeader` so the trail stays **inside the sticky header** above the toolbar (see `KubernetesDashboardPage.tsx`). Do **not** repeat the same label as both `title` and the last breadcrumb. Top-level tools (e.g. Service Map) may omit `breadcrumbs` if `<Head><title>` and the sidebar active state are enough.

### Search and Chart Explorer (complex query chrome)

These pages use bespoke multi-row toolbars instead of a single title row. That is intentional until those flows are redesigned. Do not force a `title` on them; if you add a header row, use `PageHeader` `children` or a dedicated toolbar component, not ad-hoc `Text size="xl"` in the body.

### Client Sessions (query + list)

Sessions keeps a **single-row** query toolbar (source, where filter, time range, Run). Put the full toolbar in a custom `PageHeader` via `PageLayout` `header` — do not split controls across `title` / `leading` / `actions` / `content`.

## Do / don't

```tsx
// ❌ Ad-hoc title in page body
<Group justify="space-between">
  <Text size="xl">Service Map</Text>
  <TimePicker ... />
</Group>

// ✅ Dashboard tool page: breadcrumbs in header, inputs in same sticky block (no `title`)
<PageLayout
  breadcrumbs={<Breadcrumbs>...</Breadcrumbs>}
  leading={<SourceSelect ... />}
  actions={<TimePicker ... />}
  content={<>...</>}
/>

// ❌ Title + breadcrumbs repeating the same page name
<PageLayout title="Kubernetes Dashboard" breadcrumbs={<Breadcrumbs>… Kubernetes</Breadcrumbs>} />

// ❌ Duplicate padding wrapper around the whole page including title
<Box p="sm">
  <Text size="xl">Alerts</Text>
  ...
</Box>

// ✅ Header outside padded content
<PageHeader title="Alerts" />
<Container py="lg">...</Container>
```

## Migrating an existing page

1. Replace `Text size="xl"` title + `Group justify="space-between"` with `PageLayout` or `PageHeader` slots.
2. Move time picker and primary actions to `actions`.
3. Move source pickers and badges to `leading`.
4. If the sticky bar has inputs, **do not** set `title`; pass **`breadcrumbs`** on `PageLayout` when the route has a hierarchy (breadcrumbs render inside the sticky `PageHeader`, not in `content`).
5. Keep `data-testid` on `PageLayout` / page root for E2E tests.
6. Run affected Playwright tests (`packages/app/tests/e2e/`).

## Pages using PageHeader / PageLayout today

- Alerts, Dashboards, Saved Searches — `PageHeader` with `title`
- Team — custom `PageHeader` `children` (editable name)
- Service Map — `PageLayout` with `fillViewport`, `leading` / `actions` only (no `title`; top-level tool)
- Kubernetes Dashboard, Clickhouse Dashboard — `PageLayout` with `breadcrumbs`, `leading`, `actions`, `padded` (no `title`)
- Client Sessions — `PageLayout` with custom `PageHeader` containing the full single-row query toolbar

## Compact viewports

A viewport under 900px is compact. `useCompactViewport` (`packages/app/src/components/CompactViewport/useCompactViewport.ts`) is the cutoff, and the nav collapses on the same width. Pages that switch layout use this hook.

A page that is a side panel plus a main pane uses `ResponsiveSidePanel` (`packages/app/src/components/CompactViewport/ResponsiveSidePanel.tsx`):

- Wide: the panel sits beside the main pane.
- Compact: the main pane uses the full width. The panel opens in a drawer and does not take horizontal space. Pass a `title`; the drawer has no default. The panel stays unmounted until the first open, then stays mounted so closing the drawer does not drop its state.

The caller owns whether the panel is open. Keep that state separate from any desktop collapse preference stored in localStorage. A phone session that wrote the desktop preference would hide the panel the next time the same browser opened the page on a desktop.

Give the main pane `flex: 1` and `min-height: 0` inside a full-height column, so it keeps the space under the toolbar and scrolls inside itself. A hard `min-width` on the panel inside `overflow: hidden` clips the main pane on a phone.

Search is the first page on this pattern. Other side-panel pages should adopt it the same way instead of a one-off media query.

## Knip

`packages/app` Knip entry roots are `pages/`, `scripts/`, and e2e tests. After you add or move a `PageLayout` import, run `yarn knip` from the repo root (or `yarn knip` in `packages/app` if configured) so new consumers stay wired.
