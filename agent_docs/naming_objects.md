# Naming objects

Every user-named object (dashboard, saved search, dashboard tile, alert, and so
on) gets its name through one control: `InlineNameInput`. It looks like plain
title text until you hover or click it, then edits in place. There is no pencil
button, no double-click, no separate "Save name" button, and no naming step
inside a save modal.

```tsx
import {
  InlineNameInput,
  InlineNameInputControlled,
} from '@/components/InlineNameInput/InlineNameInput';
```

## Pick the variant by how the object is saved

| The object is...                                                         | Use                                                   | When the name is saved                                                                  |
| ------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Already saved, and the page shows it (dashboard page, saved search page) | `InlineNameInput` with `onCommit`                     | Immediately. Enter or blur commits, Escape reverts, an empty or unchanged name reverts. |
| A draft in an editor (tile editor, new chart, new saved search)          | `InlineNameInputControlled` with the form's `control` | With the rest of the form, when the user presses the editor's save button.              |

A rename on a saved object is an arrangement change, like moving a tile, so it
saves without a confirmation. A name on a draft is part of the draft's content,
so it waits for the explicit save.

## Size and placement

Sizes go from `xs` to `md`. Don't add larger ones.

- `size="md"`: the page title, top-left of the page body under the breadcrumbs.
  Pass `headingLevel` so the name is still the page heading for screen readers
  and `getByRole('heading')`. Use `headingLevel={3}` to match the existing
  dashboard and saved search pages.
- `size="sm"` (default): editor headers, next to the close button and before the
  editor's actions, and the name row at the top of the chart editor.
- `size="xs"`: compact rows, such as a name inside a dense form or list.

## Copy

- `aria-label` is required because there is no visible label: "Dashboard name",
  "Saved search name", "Tile name".
- The placeholder is "Untitled" plus the object type in sentence case: "Untitled
  dashboard", "Untitled search", "Untitled tile". Don't use "Name".
- Don't add a "Name" label or helper text next to the field.

## Examples

Saved object, saves on commit:

```tsx
<InlineNameInput
  value={dashboard.name}
  onCommit={name => setDashboard({ ...dashboard, name })}
  placeholder="Untitled dashboard"
  aria-label="Dashboard name"
  size="md"
  headingLevel={3}
  data-testid="dashboard-name-input"
/>
```

Draft, saves with the form:

```tsx
<InlineNameInputControlled
  control={control}
  name="name"
  size="sm"
  placeholder="Untitled tile"
  aria-label="Tile name"
  data-testid="chart-name-input"
/>
```

## Don't

- Don't build a click-to-edit title with a pencil `ActionIcon` and an edit mode.
  That was `EditablePageName`, which this replaces.
- Don't use a bordered `TextInput` for an object's own name in a page or editor
  header.
- Don't ask for the name in a modal before saving. Name inline, then save.
- Don't show a success toast for a rename. Show an error toast if the save
  fails.

## Testing

- The field is a textbox, so assert with `toHaveValue`, not `toHaveText`.
- To rename in E2E: `fill()` the input, then press Enter. See
  `DashboardPage.renameDashboard` in `packages/app/tests/e2e/page-objects/`.
- Storybook: **Components/InlineNameInput** shows both variants and sizes.
