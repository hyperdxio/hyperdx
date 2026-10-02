---
name: naming-objects
description:
  Name user-created objects (dashboards, saved searches, tiles, alerts) with the
  shared InlineNameInput. Use when adding or changing the place where a user
  names or renames something, building an editor or page header that shows an
  object's name, or when tempted to add a pencil edit button, a "Name" field in
  a save modal, or a bordered name TextInput.
---

# Naming objects

Read **`agent_docs/naming_objects.md`** before changing how something is named.
It is the source of truth; this skill is the short version.

## Quick rules

1. Use `InlineNameInput` / `InlineNameInputControlled` from
   `@/components/InlineNameInput/InlineNameInput`. Never build a separate
   click-to-edit title, pencil button, or "Save name" button.
2. **Saved object shown on its page** → `InlineNameInput` with `onCommit`. Enter
   or blur saves immediately; Escape and empty names revert.
3. **Draft in an editor** → `InlineNameInputControlled` with the form's
   `control`. The name saves with the editor's save button.
4. Page titles use `size="lg"` (default) with `headingLevel={3}`. Editor headers
   use `size="sm"`.
5. Always set `aria-label` ("Dashboard name") and an "Untitled …" placeholder in
   sentence case ("Untitled tile").
6. Don't ask for a name inside a save modal. Name inline, then save.
7. In tests, assert the name with `toHaveValue`. In E2E, `fill()` then press
   Enter.

## Workflow

1. Read `agent_docs/naming_objects.md`.
2. Look at the reference usages: `DBDashboardPage.tsx` (dashboard name) and
   `DBSearchPage.tsx` (saved search name).
3. Check the stories in Storybook under **Components/InlineNameInput**.
4. Update E2E page objects that read the name as text.
5. Run `yarn lint:fix` in the repo root.
