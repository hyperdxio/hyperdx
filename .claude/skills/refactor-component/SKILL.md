---
name: refactor-component
description: Refactor a large React component file into a directory of smaller files. Use when the user asks to break up, split, or refactor a big component file.
---

# Refactor Large Component into Directory

Break a monolithic React component file into a well-organized directory with no functionality changes.

The target component is: $ARGUMENTS

If no component is specified, ask the user which file to refactor.

## Workflow

### 1. Check E2E test coverage

Before touching any code, verify that the component's key user flows are covered by E2E tests. Search for Playwright test files (typically in `packages/app/tests/e2e/`) that exercise the component — look for references to its `data-testid` attributes, page object methods, or user-visible behaviour (e.g. clicking Run, Save, switching chart types, SQL mode).

- **If good coverage exists**: note the relevant test files and move on. These tests become your safety net — you will re-run them after the refactor to catch regressions.
- **If coverage is missing or thin**: stop and ask the user whether they want to add E2E tests before refactoring. Present the gaps you found (e.g. "raw SQL chart creation has no E2E test") and let the user provide test requirements. Use the `playwright` skill to create the tests, then run them to confirm they pass on the current (pre-refactor) code. Only proceed with the refactor once the baseline E2E tests are green.

This step is critical — E2E tests are the strongest guarantee that the refactor doesn't break real user flows. Unit tests alone cannot catch issues like missing DOM elements that only appear when the full app is composed.

### 2. Analyse the file

Read the entire target file. Identify:

- **Main component** — the default export (becomes the primary file in the new directory)
- **Sub-components** — named function/const components used only inside this file
- **Types & interfaces** — exported or internal types tied to the sub-components
- **Utilities** — pure functions, Zod schemas, constants that aren't React components
- **Tests** — any test file in a sibling `__tests__/` directory that imports the target

Create a plan listing each new file, what goes in it, and which imports change. Present the plan to the user and wait for approval before writing code.

### 3. Create the directory and files

The new directory is created inside `packages/app/src/components/`, replacing the original file. It keeps the same name (without extension), so external imports resolve unchanged.

```
packages/app/src/components/ComponentName/
  index.ts              — barrel re-export of the default export
  ComponentName.tsx     — main component (default export)
  SubComponent.tsx      — one file per sub-component (named export)
  utils.ts              — utility functions, schemas, constants
  __tests__/            — moved test files with updated imports
```

#### Rules

- **`index.ts`** is the single public API of the directory. All exports that consumers depend on must be re-exported through `index.ts`. Sub-components or utilities that are only used within the directory should **not** be re-exported.
- Each sub-component file has a **named export** (not default).
- **Sibling imports** within the directory use `./` relative paths. Files outside the directory must never import directly from a sub-file (e.g. `ComponentName/ChartActionBar`) — they import from the directory barrel (`ComponentName`) only.
- **All other relative imports** (`../Foo`, `./Foo`) in the extracted files must be converted to `@/`-prefixed absolute imports (e.g. `@/components/Foo`). This is critical — files moved one level deeper will break if relative paths aren't updated.
- Existing `@/`-prefixed imports stay unchanged.
- Do not add, remove, or rename any exports. The refactoring must be invisible to consumers.

### 4. Move tests

Move `__tests__/ComponentName.test.tsx` into `ComponentName/__tests__/ComponentName.test.tsx`.

Update in the test file:

- The main import: `from '../ComponentName'` → `from '..'`
- Mock paths: `../SiblingComponent` → `../../SiblingComponent` (one extra level up)

### 5. Delete the original file

Remove the original monolithic `.tsx` file only after all new files are written.

### 6. Tidy up

After the initial split, clean up duplication and improve structure within the new directory:

#### Remove unnecessary indirection

- If a component is declared as `function FooComponent` and then aliased as `export const Foo = FooComponent`, rename the function to `Foo` and export it directly.

#### Deduplicate code across files

- Look for validation+normalization logic repeated across callbacks — extract a shared helper (e.g. `validateAndNormalize`) that returns `{ errors, config }` so each caller only contains its unique logic.
- Deduplicate `renderComponent` helpers in test files — hoist a single shared factory to file scope. Describe blocks with special defaults can wrap it in a thin helper (e.g. `renderAlertComponent`) that passes overrides.

#### Extract pure logic into utils.ts

Scan component files for logic that can move into `utils.ts`:

- **Pure functions in `useMemo` callbacks** — if the memo body is a pure transformation (no hooks, no JSX), extract it as a named function in `utils.ts` and call it from the memo.
- **Constants and lookup tables** — arrays/sets used in conditionals (e.g. `['table', 'time', 'number', 'pie'].includes(tab)`) become named exports (e.g. `TABS_WITH_GENERATED_SQL`).
- **Simple mappings** — switch/if chains that map one value to another (e.g. `DisplayType` → tab string) become standalone functions. These don't need `useMemo` since they're cheap.
- **Complex config builders** — conditional logic that selects/transforms configs for display (e.g. building sample events config, chart explanation config) should be pure functions that receive all dependencies as parameters.

Good extraction candidates:

- Config builder functions (`buildSampleEventsConfig`, `buildChartConfigForExplanations`)
- Enum/type mappers (`displayTypeToActiveTab`)
- Computed values with alert logic (`computeDbTimeChartConfig`)

Leave in the component:

- Logic that reads/writes React state or calls hooks
- Event handlers that call `setValue`, `onSubmit`, etc.
- JSX rendering logic

#### Use named prop types

All components should use named type aliases for their props, declared directly above the component function:

```tsx
type FooProps = {
  bar: string;
  onBaz: () => void;
};

export function Foo({ bar, onBaz }: FooProps) {
```

Do not use inline object types in the function signature.

#### Split large components further

If a file exceeds ~500 lines after the initial split, look for natural extraction points:

- **Form inputs + toolbar** — form fields, series editors, action buttons → `ChartEditorControls.tsx`
- **Preview/results area** — chart rendering, accordions, result display → `ChartPreviewPanel.tsx`
- **The main file** becomes a thin orchestrator: form state, hooks, callbacks, effects, and a JSX shell that renders the sub-components.

When splitting JSX, the extracted component receives form state via props (`control`, `setValue`, etc.). Watches that are only used in the extracted component (e.g. `alertChannelType`) can use `useWatch` inside it rather than being passed as props.

#### Classify shared vs conditional JSX before extracting

Before moving JSX into a new component, map the render tree's branching structure. Every piece of JSX must be classified as either:

- **Branch-specific** — rendered inside one arm of a conditional (ternary, `&&`, if/else)
- **Shared** — rendered as a sibling of the conditional, appearing for all branches

**Extract from the bottom up**: pull out the conditional/branch-specific parts first, leaving shared sections in the parent. Never bundle shared JSX into a component that only renders for one branch.

**Verify after extraction**: for each value of every conditional, confirm the new code renders the same set of components as the original. A toolbar, action bar, or footer that appeared for all chart types must still appear for all chart types after the split.

### 7. Write unit tests for extracted code

This is a dedicated step — do not skip it or fold it into another step.

#### Tests for `utils.ts`

Write unit tests in `__tests__/utils.test.ts` covering:

- All pure functions with normal inputs, edge cases, and null/undefined guards
- Constants (verify membership)
- Config builders (test null returns for invalid inputs, verify output shape for valid inputs)

#### Tests for each extracted component

Write unit tests for each extracted component in `__tests__/<ComponentName>.test.tsx` covering:

- **Conditional rendering**: for each prop/state that controls visibility, verify elements appear and disappear correctly
- **Callbacks**: verify that prop callbacks are invoked on user interaction (clicks, etc.)
- **Prop-driven behaviour**: test that props like `activeTab`, `isRawSqlInput`, `isSaving` produce the correct UI state (disabled buttons, hidden sections, etc.)
- **Regression coverage**: if the extraction was motivated by a bug (e.g. shared controls missing for a specific mode), include a test that explicitly renders the component in that mode and asserts the controls are present

Use a `FormWrapper` test helper when the component requires react-hook-form's `control`/`handleSubmit` — create a small wrapper that calls `useForm` with sensible defaults and passes the form methods to the component under test via a render-prop pattern. Mock heavy child components (chart renderers, SQL editors, etc.) with simple stubs that render a `data-testid`.

### 8. Verify

Run in order — fix any failures before proceeding to the next step:

```bash
make ci-lint    # TypeScript compilation + lint
```

```bash
cd packages/app && yarn ci:unit   # Unit tests (or the appropriate package)
```

```bash
make e2e   # E2E tests — re-run the same tests from step 1 to catch regressions
```

If lint fails with import-sort or formatting errors, run `npx eslint --fix <file>` on the affected files and re-check. If there are unused-import warnings, remove the unused imports manually.

If an E2E test fails, investigate whether the failure is related to the refactoring (e.g. a broken import path at runtime) or a pre-existing flake. Fix refactoring-related failures before presenting the result. The E2E tests identified in step 1 are the most important — if those pass, the refactor is safe.

## Checklist (self-review before presenting result)

- [ ] E2E test coverage verified (or added) before refactoring began
- [ ] No functionality changes — pure file reorganisation
- [ ] Shared JSX (toolbars, action bars, footers) not accidentally bundled into a conditional branch's component
- [ ] `index.ts` barrel makes the directory a drop-in replacement
- [ ] All relative imports in extracted files converted to `@/` prefixed
- [ ] Sibling imports within directory use `./`
- [ ] Test file moved and import paths updated (both main import and mocks)
- [ ] Original monolith file deleted
- [ ] Duplicated logic extracted into shared helpers
- [ ] Pure functions moved from components to `utils.ts`
- [ ] All components use named prop types declared above the function
- [ ] No file exceeds ~500 lines (split further if needed)
- [ ] Unit tests written for `utils.ts` functions
- [ ] Unit tests written for each extracted component (conditional rendering, callbacks, regression cases)
- [ ] `make ci-lint` passes
- [ ] Unit tests pass
- [ ] E2E tests pass
