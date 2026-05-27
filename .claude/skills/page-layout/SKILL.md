---
name: page-layout
description: Add or update app page headers and layout using PageHeader and PageLayout. Use when creating a new page, fixing inconsistent headers, or migrating Service Map / Kubernetes / dashboard pages to the shared layout.
---

# Page layout and headers

Read **`agent_docs/page_layout.md`** before changing any page shell. It is the source of truth for API, examples, and migration steps.

## Quick rules

1. **Default for new pages**: `PageLayout` with `title`, optional `leading` / `actions`, and `content` — only when the sticky bar is **text-only** (no inputs in that bar).
2. **Sticky bar contains inputs** (source pickers, SQL/search, sliders, time range, Run, etc.): **do not** use `PageHeader` / `PageLayout` **`title`**. The sticky row is for controls only. Put **where you are** in the **`breadcrumbs` prop** (renders **inside the sticky `PageHeader`**, above the toolbar) when the page lives under a hierarchy (e.g. `Dashboards` → `Kubernetes`); otherwise you may omit `breadcrumbs` and rely on `<Head><title>`, the sidebar active item, and the empty state copy.
3. **Never** duplicate location: do not set `title="Kubernetes Dashboard"` **and** breadcrumbs that repeat the same page name.
4. **Never** use `<Text size="xl">` as the page title in the body.
5. **Global controls** (time range, Run, Save, sampling) go in `actions`, right-aligned. **Context** pickers go in `leading` (no `title` when those slots are used for inputs). **Breadcrumbs** use the `breadcrumbs` prop so they stay in the sticky header, not in `content`.
6. **Full-height tools** (maps, large charts): `fillViewport` on `PageLayout`.
7. **Search / Chart Explorer**: keep bespoke toolbars unless the task is explicitly to redesign them.

## Workflow

1. Read `agent_docs/page_layout.md`.
2. Open a similar page already on `PageHeader` / `PageLayout` (e.g. `AlertsPage.tsx`, `DBServiceMapPage.tsx`, `KubernetesDashboardPage.tsx`).
3. Implement using `@/components/PageLayout` or `@/components/PageHeader`.
4. Preserve or add `data-testid` on the page root for E2E tests.
5. Run `yarn lint:fix` in the repo root when done.
6. If the page has E2E coverage, run the relevant spec under `packages/app/tests/e2e/`.

## Imports

```tsx
import { PageHeader } from '@/components/PageHeader';
import { PageLayout } from '@/components/PageLayout';
```

## Reference implementations

| Page | File | Pattern |
|------|------|---------|
| List page | `AlertsPage.tsx` | `PageHeader` + `title` + `Container` (no inputs in header) |
| Tool page with inputs + hierarchy | `KubernetesDashboardPage.tsx`, `ClickhousePage.tsx` | `PageLayout` **without** `title`; **`breadcrumbs`** + `leading` + `actions` in one sticky header |
| Tool page (top-level) | `DBServiceMapPage.tsx` | `PageLayout` **without** `title`; `leading` / `actions` only; no duplicate breadcrumb unless you add a real hierarchy |
| Custom toolbar | `SessionsPage.tsx` | `PageLayout` + `header` = custom `PageHeader` `children` (single-row inputs, no `title`) |
| Custom title | `TeamPage.tsx` | `PageHeader` with `children` only |
