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

### DO NOT USE (Forbidden Patterns)

The following patterns are **NOT ALLOWED** for Button and ActionIcon:

```tsx
// ❌ WRONG - Don't use these
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

// ✅ CORRECT - Use custom variants
<Button variant="primary">Save</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger">Delete</Button>
<ActionIcon variant="primary">...</ActionIcon>
<ActionIcon variant="secondary">...</ActionIcon>
<ActionIcon variant="danger">...</ActionIcon>
```

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

## Refactoring

- Edit files directly - don't create `component-v2.tsx` copies
- Look for duplicate code across the affected area
- Verify all callers and integrations after changes
- Refactor to improve clarity or reduce complexity, not just to change

## File Naming

- Clear, descriptive names following package conventions
- Avoid "temp", "refactored", "improved" in permanent filenames

