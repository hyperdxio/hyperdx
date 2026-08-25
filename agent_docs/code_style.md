# Code Style & Best Practices

> **Note**: Pre-commit hooks handle formatting automatically. Focus on implementation patterns.

## TypeScript

- Avoid `any` - use proper typing
- Avoid `as` casts, use `satisfies` or type inference whenever possible
- Use Zod schemas for runtime validation
- Define clear interfaces for data structures
- Implement proper error boundaries
- Define and import reusable named types instead of repeating verbose types

## Code Organization

- **Single Responsibility**: One clear purpose per component/function
- **File Size**: Max 300 lines - refactor when approaching limit
- **DRY**: Reuse existing functionality; consolidate duplicates
- **In-Context Learning**: Explore similar files before implementing

## React Patterns

- Functional components with hooks (not class components)
- Write small, focused components
- Extract reusable logic into custom hooks
- Define TypeScript interfaces for props
- Use proper keys for lists, memoization for expensive computations

## Mantine UI Components

The project uses Mantine UI with **custom variants** defined in `packages/app/src/theme/mantineTheme.ts`.

- Prefer Mantine components over custom-styled elements
- Prefer individual Mantine style props (eg. `m='xs'`) over raw styles (eg. `style={{ margin: '4px' }}`)

### Button & ActionIcon Variants (REQUIRED)

**ONLY use these variants for Button and ActionIcon components:**

| Variant | Use Case | Example |
|---------|----------|---------|
| `variant="primary"` | Primary actions (Submit, Save, Create, Run) | `<Button variant="primary">Save</Button>` |
| `variant="secondary"` | Secondary actions (Cancel, Clear, auxiliary actions) | `<Button variant="secondary">Cancel</Button>` |
| `variant="danger"` | Destructive or error-severity actions (Delete, Remove, Error filter) | `<Button variant="danger">Delete</Button>` |
| `variant="warning"` | Caution or warning-severity actions (Warning filter, Slow spans) | `<Button variant="warning">Warning</Button>` |
| `variant="link"` | Link-style actions with no background or border (View Details, navigation-style CTAs) | `<Button variant="link">View Details</Button>` |
| `variant="subtle"` | Transparent background with hover highlight; for toolbar/utility controls that shouldn't draw attention until hovered (collapse toggles, close buttons, auxiliary actions) | `<Button variant="subtle">Filter</Button>` |

### Correct Usage

```tsx
<Button variant="primary">Save</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger">Delete</Button>
<Button variant="warning">Warning</Button>
<Button variant="subtle">Filter</Button>
<Button variant="link">View Details</Button>
<ActionIcon variant="primary">...</ActionIcon>
<ActionIcon variant="secondary">...</ActionIcon>
<ActionIcon variant="danger">...</ActionIcon>
<ActionIcon variant="warning">...</ActionIcon>
<ActionIcon variant="link">...</ActionIcon>
<ActionIcon variant="subtle">...</ActionIcon>
```

### DO NOT USE (Forbidden Patterns)

```tsx
<Button variant="light" color="green">Save</Button>
<Button variant="light" color="gray">Cancel</Button>
<Button variant="light" color="red">Delete</Button>
<Button variant="outline" color="green">Save</Button>
<Button variant="outline" color="gray">Cancel</Button>
<Button variant="outline" color="red">Delete</Button>
<Button variant="filled" color="gray">Cancel</Button>
<Button variant="default">Cancel</Button>
<ActionIcon variant="light" color="red">...</ActionIcon>
<ActionIcon variant="filled" color="gray">...</ActionIcon>
```

**Link variant details**: Renders with no background, no border, and muted text color. On hover, text brightens to full contrast. Use for link-style CTAs that should blend into surrounding content (e.g., "View Details", "View Full Trace").

**Subtle variant details**: Transparent background with standard text color. On hover, a subtle background highlight appears (`--color-bg-hover`). This is the **default** ActionIcon variant. Use for toolbar icons, collapse toggles, close buttons, and utility controls that should stay unobtrusive but reveal interactivity on hover. Unlike `link`, `subtle` shows a hover background rather than changing text color.

**Note**: `variant="filled"` is still valid for **form inputs** (Select, TextInput, etc.), just not for Button/ActionIcon.

### Icon-Only Buttons → ActionIcon

**If a Button only contains an icon (no text), use ActionIcon instead:**

```tsx
// ❌ WRONG - Button with only an icon
<Button variant="secondary" px="xs">
  <IconRefresh size={18} />
</Button>

// ✅ CORRECT - Use ActionIcon for icon-only buttons
<ActionIcon variant="secondary" size="input-sm">
  <IconRefresh size={18} />
</ActionIcon>
```

This pattern cannot be enforced by ESLint and requires manual code review.

### Semantic component variants (Alert / Text / danger controls)

We ship **themed semantic variants** for `Alert`, `Text`, `Button`, and `ActionIcon` so callouts and status text are token-driven and consistent across the HyperDX and ClickStack brands (and light/dark). **Prefer these over raw Mantine palette colors** (`color="yellow"`, `color="red"`, `c="green"`, etc.).

The variant → token mapping is centralized in `packages/app/src/theme/themes/semanticVariants.ts` (the single source of truth, consumed by both brand themes' `mantineTheme.ts`). See the Storybook stories `Components/Alert` (interactive `Playground`) and `Design tokens/Semantic variants` for the full visual matrix.

**`Alert`** — `info` | `success` | `warning` | `danger`. Renders a tinted `-subtle` background with the title, icon, **and body text** in the semantic color token:

```tsx
// ✅ token-driven, works in both brands + light/dark, meets WCAG AA
<Alert variant="warning" title="Heads up">This may take a while.</Alert>
<Alert variant="danger" title="Failed">Could not save the alert.</Alert>

// ❌ hardcoded Mantine palette — not theme-aware, inconsistent contrast
<Alert color="yellow" title="Heads up">...</Alert>
<Alert color="red" title="Failed">...</Alert>
```

**`Text`** — `danger` | `warning` | `success` for inline status/validation text:

```tsx
<Text variant="danger">Required field</Text>
<Text variant="success">Connection verified</Text>

// ❌ don't reach for raw palette colors for semantic status text
<Text c="red.5">Required field</Text>
```

**`Button` / `ActionIcon` `variant="danger"`** is a **soft** control: a tinted `--color-bg-danger-subtle` background (with hover) and semantic foreground, not a solid red fill. `warning`/`success` are intentionally **not** exposed as control variants — use them on `Text` and `Alert` only.

**Note**: Existing `<Alert color="...">` call sites are untouched; the semantic variants are opt-in. Prefer the variant for any **new** callout, and migrate nearby `color="..."` alerts when you touch them.

### Confirmation dialogs: use `useConfirm` (REQUIRED)

**Use `useConfirm` (`@/useConfirm`) for any "are you sure?" step. Do not
hand-roll a `<Modal>` with Cancel/Confirm buttons.** The provider is already
mounted app-wide in `pages/_app.tsx`, so there is no setup at the call site.

```tsx
const confirm = useConfirm();

const handleDelete = async () => {
  if (
    await confirm(
      <>
        Deleting {name} is <b>not reversible</b>.
      </>,
      'Delete',
      { variant: 'danger' },
    )
  ) {
    await deleteThing.mutateAsync({ id });
  }
};
```

- The message is a `ReactNode`, so it can carry emphasis and multiple sentences.
- Pass `{ variant: 'danger' }` for destructive actions; the confirm label
  defaults to `Confirm`.
- It resolves **exactly once**, so a double click on Confirm during the modal's
  exit transition cannot fire the action twice. A hand-rolled modal has to guard
  that itself.
- Test ids are shared and already exist: `confirm-modal`,
  `confirm-confirm-button`, `confirm-cancel-button`. **Do not invent per-flow
  confirm/cancel test ids** — E2E page objects key off the shared ones.

**Known limits.** It passes no `title` to the Modal and renders the body at
`size="sm" opacity={0.7}`, and CSS opacity applies to the whole subtree so a
nested `<Text>` cannot opt back out. If a flow genuinely needs a heading or
full-contrast body, **extend `useConfirm`** (an optional prop, applied to all
call sites) rather than forking a one-off modal.

**In component tests**, mock it — `ConfirmProvider` pulls in `next/router`,
which is not available in jsdom:

```tsx
jest.mock('@/useConfirm', () => ({ useConfirm: jest.fn() }));
```

Assert on the arguments (and render the message `ReactNode` if you need to check
the copy). Exercise the real dialog in E2E instead.

### EmptyState Component (REQUIRED)

**Use `EmptyState` (`@/components/EmptyState`) for all empty/no-data states.** Do not create ad-hoc inline empty states.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `icon` | `ReactNode` | — | Icon in the theme circle (hidden if not provided) |
| `title` | `string` | — | Heading text (headline style — no trailing period) |
| `description` | `ReactNode` | — | Subtext below the title |
| `children` | `ReactNode` | — | Actions (buttons, links) below description |
| `variant` | `"default" \| "card"` | `"default"` | `"card"` wraps in a bordered Paper |

```tsx
// ❌ BAD - ad-hoc inline empty states
<div className="text-center my-4 fs-8">No data</div>
<Text ta="center" c="dimmed">Nothing here</Text>

// ✅ GOOD - use the EmptyState component
<EmptyState
  icon={<IconBell size={32} />}
  title="No alerts created yet"
  description="Create alerts from dashboard charts or saved searches."
  variant="card"
/>
```

**Title copy**: Treat `title` as a short headline (like `Title` in the UI). Do **not** end it with a period. Use `description` for full sentences, which should use normal punctuation including a trailing period when appropriate. Match listing pages (e.g. dashboards and saved searches use parallel phrasing such as “No matching … yet” / “No … yet” without dots).

### Code snippets (REQUIRED)

**Do not render raw `<pre>`, ad-hoc `Paper` + monospace text, or unstyled `<code>`.** Use the existing Mantine/product components so snippets match Terraform export, onboarding, and Storybook guidelines.

| Kind | Component | When |
|------|-----------|------|
| **Inline code** | Mantine `<Code>` | Short tokens in prose (`Session`, a column name, a flag). |
| **Fenced / multi-line / copyable** | `CopySnippet` (`@/components/ClickStackOnboarding/CopySnippet`) | Install commands, HCL, JSX examples, any block the user might copy. Wraps `<Code block>` plus a Copy button. |

```tsx
// ✅ inline — Mantine Code
Create a source with <Code>Session</Code> type.

// ✅ fenced / copyable — CopySnippet (Code + Copy)
<CopySnippet
  label="Import block"
  snippet={`import { clickstack_dashboard } from "clickhouse/clickstack"`}
/>

// Label is optional when the surrounding heading already names the snippet
<CopySnippet snippet={USAGE} />

// ❌ BAD — raw pre / Paper chrome
<pre>{snippet}</pre>
<Paper bg="var(--color-bg-code)"><Text component="pre" ff="monospace">{snippet}</Text></Paper>
```

**SQL query previews** (rendered ClickHouse SQL with highlighting) still use `SQLPreview` / `ChartSQLPreview` — those are editors, not snippet chrome.

Storybook: `Components/Code` (live `InlineCode`, `FencedBlocks`, and `Usage`). Guidelines markdown maps fenced blocks → `CopySnippet` and inline `` `code` `` → `<Code>` automatically. Follow the same split in app UI.

### Chart cards (ChartCard)

**Use `ChartCard` (`@/components/charts/ChartCard`) to wrap a chart in a card.**
It is a bordered surface with the same header treatment as a custom dashboard
tile (a full-bleed divider under the title). It replaces the older `ChartBox`;
don't hand-roll a bordered `<div>`/`<Paper>` around a chart.

`ChartCard` renders the card **chrome only**. The header divider is drawn only
when a descendant renders a `ChartContainer` with a `title` (or `toolbarItems`) —
`ChartCard` supplies the `ChartContainerCardHeaderProvider` that switches that
header into card mode — so put a chart that renders a `ChartContainer` inside it
(`DBTimeChart`, `DBTableChart`, `DBHeatmapChart`, `DBListBarChart`, …). Content
with its own heading (e.g. a bespoke table card) should still route that heading
through a titled `ChartContainer` rather than a bare `Text`, so it gets the same
card header — divider and top padding included — instead of sitting flush against
the top border. The tile-level controls (fullscreen, line/bar display switcher,
kebab menu) belong to dashboard tiles and are intentionally **not** part of
`ChartCard`.

| Prop | Type | Description |
|------|------|-------------|
| `children` | `ReactNode` | The chart, usually a `DB*Chart` (or a titled `ChartContainer`) |
| `style` | `CSSProperties` | Sizing/overflow override — pass a fixed `height`, or `flex: 1; height: 100%` to fill a flex row (`paddingInline` is pinned to keep the divider aligned) |
| `data-testid` | `string` | Test hook |

```tsx
// ✅ GOOD — shared card chrome, consistent with dashboard tiles
<ChartCard style={{ height: 350 }}>
  <DBTimeChart title="Request Latency" config={config} />
</ChartCard>

// ❌ BAD — hand-rolled card that drifts from the dashboard look
<Box style={{ border: '1px solid var(--color-border)', borderRadius: 4 }}>
  <DBTimeChart title="Request Latency" config={config} />
</Box>
```

**Give it a height.** `ChartCard` is `width: 100%` and fills its parent, so the
parent (or a `style={{ height }}`) must define the height. For equal-width
side-by-side charts (e.g. the RED row) use
`style={{ flex: 1, minWidth: 0, minHeight: 0, height: '100%' }}` inside a
`Flex`. See the `Charts/ChartCard` Storybook stories for the variants.

## UI text: use sentence case

All user-facing text uses **sentence case** — capitalize only the **first word**
and any proper nouns/acronyms. Do **not** use Title Case (capitalizing every
significant word).

This applies to every string a user reads: field labels, buttons, tab/menu
items, headings, section titles, modal titles, placeholders, tooltips, table
column headers, empty states, and toast/notification copy.

| Title Case (avoid) | Sentence case (use) |
|--------------------|---------------------|
| `Data Source`      | `Data source`       |
| `Chart Name`       | `Chart name`        |
| `Add Series`       | `Add series`        |
| `Count of Events`  | `Count of events`   |
| `Save Changes`     | `Save changes`      |
| `Delete Dashboard` | `Delete dashboard`  |

**Keep the original casing of proper nouns, product names, and acronyms**
anywhere in the string — sentence case only changes the words around them:
HyperDX, ClickHouse, ClickStack, OpenTelemetry/OTel, Lucene, SQL, PromQL,
MongoDB, Kubernetes, JSON, CSV, URL, ID, API, MCP, CPU, P95. For example:
`Search your events w/ Lucene`, `Edit SQL`, `Copy as cURL`, `View in ClickHouse`.

Only sentence-case **static UI chrome**. Never rewrite dynamic/user data (column
names, tag values, log/trace content, source or dashboard names a user typed) —
render those verbatim.

## Semantic design tokens (prefer over raw Mantine colors)

The UI is built with **Mantine components**, but **colors and surfaces** should follow the **semantic CSS custom properties** in our themes (`--color-*`, etc.), not ad-hoc Mantine palette values. Those tokens are defined in `packages/app/src/theme/themes/**/_tokens.scss`, align with a **Click UI**–style system, and keep HyperDX and ClickStack visually consistent. They are the path toward a shared design system even while Mantine remains the component layer.

- **Do**: Use Mantine for layout, components, and spacing; use **semantic tokens** for themed backgrounds, text colors, borders, and states (e.g. `style={{ color: 'var(--color-text-muted)' }}` or `style={{ border: '1px solid var(--color-border)' }}`).
- **Do not**: Rely on raw Mantine color props for app chrome and content when a semantic token exists — e.g. `c="gray.5"`, `bg="dark.7"`, or arbitrary `color="blue.4"` for surfaces that should match the rest of the product.
- **Reference**: `packages/app/src/theme/semanticColorsGrouped.ts` (token names), theme SCSS under `packages/app/src/theme/themes/`, and Storybook (`SemanticColors` and related theme stories) for a visual map.

Mantine theme overrides in `packages/app/src/theme/**` may map Mantine’s scale to our palette; that does not replace using **`var(--color-...)`** in new styling where you need explicit color control.

**Chart and visualization colors are a separate, more specific contract** — they have their own categorical, semantic, and heatmap palettes wired through `packages/app/src/utils.ts` helpers. Don't hard-code series colors or reuse `--color-text-*` for charts. See [`data_viz_colors.md`](./data_viz_colors.md) before touching anything that renders data.

## Refactoring

- Edit files directly - don't create `component-v2.tsx` copies
- Look for duplicate code across the affected area
- Verify all callers and integrations after changes
- Refactor to improve clarity or reduce complexity, not just to change

## File Naming and Organization

- Clear, descriptive names following package conventions
- Avoid "temp", "refactored", "improved" in permanent filenames
- Put related components in a single directory
