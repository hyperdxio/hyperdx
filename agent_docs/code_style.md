# Code Style & Best Practices

> **Note**: Pre-commit hooks handle formatting automatically. Focus on implementation patterns.

## TypeScript

- Avoid `any` - use proper typing
- Use Zod schemas for runtime validation
- Define clear interfaces for data structures
- Implement proper error boundaries

## Code Organization

- **Single Responsibility**: One clear purpose per component/function
- **File Size**: Max 300 lines - refactor when approaching limit
- **DRY**: Reuse existing functionality; consolidate duplicates
- **In-Context Learning**: Explore similar files before implementing

## React Patterns

- Functional components with hooks (not class components)
- Extract reusable logic into custom hooks
- Define TypeScript interfaces for props
- Use proper keys for lists, memoization for expensive computations

## Mantine UI Components

The project uses Mantine UI with **custom variants** defined in `packages/app/src/theme/mantineTheme.ts`.

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

## Refactoring

- Edit files directly - don't create `component-v2.tsx` copies
- Look for duplicate code across the affected area
- Verify all callers and integrations after changes
- Refactor to improve clarity or reduce complexity, not just to change

## File Naming

- Clear, descriptive names following package conventions
- Avoid "temp", "refactored", "improved" in permanent filenames

