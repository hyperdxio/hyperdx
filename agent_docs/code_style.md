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
| `variant="danger"` | Destructive actions (Delete, Remove, Rotate API Key) | `<Button variant="danger">Delete</Button>` |
| `variant="link"` | Link-style actions with no background or border (View Details, navigation-style CTAs) | `<Button variant="link">View Details</Button>` |
| `variant="subtle"` | Transparent background with hover highlight; for toolbar/utility controls that shouldn't draw attention until hovered (collapse toggles, close buttons, auxiliary actions) | `<Button variant="subtle">Filter</Button>` |

### Correct Usage

```tsx
<Button variant="primary">Save</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger">Delete</Button>
<Button variant="subtle">Filter</Button>
<Button variant="link">View Details</Button>
<ActionIcon variant="primary">...</ActionIcon>
<ActionIcon variant="secondary">...</ActionIcon>
<ActionIcon variant="danger">...</ActionIcon>
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

The variant → token mapping is centralized in `packages/app/src/theme/themes/semanticVariants.ts` (the single source of truth, consumed by both brand themes' `mantineTheme.ts`). See the Storybook stories `Components/Alert` (interactive `Playground`) and `Design Tokens/Semantic Variants` for the full visual matrix.

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
