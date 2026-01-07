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

The project uses Mantine UI with **custom variants** defined in `packages/app/src/theme/mantineTheme.ts`:

### Custom Button Variants
- `variant="primary"` - Light green button for primary actions
- `variant="secondary"` - Default styled button for secondary actions  
- `variant="danger"` - Light red button for destructive actions

### Custom ActionIcon Variants
- `variant="primary"` - Light green action icon
- `variant="secondary"` - Default styled action icon
- `variant="danger"` - Light red action icon for destructive actions

These are valid variants - do not replace them with standard Mantine variants like `variant="light" color="red"`.

## Refactoring

- Edit files directly - don't create `component-v2.tsx` copies
- Look for duplicate code across the affected area
- Verify all callers and integrations after changes
- Refactor to improve clarity or reduce complexity, not just to change

## File Naming

- Clear, descriptive names following package conventions
- Avoid "temp", "refactored", "improved" in permanent filenames

