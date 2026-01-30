# Click UI Migration Notes

This document tracks issues and limitations encountered when replacing Mantine UI components with Click UI (`@clickhouse/click-ui`) components.

## Import Path

Import directly from `@clickhouse/click-ui`:

```typescript
import { Button, IconButton, Popover, TextAreaField } from '@clickhouse/click-ui';
// Note: Select is NOT migrated - use Mantine Select
```

---

## Known Issues & Limitations

### IconButton

<!-- TODO: CLICK-UI-ICONBUTTON-ICON-PROP -->
#### `icon` prop only accepts string IconName

**Issue**: The `icon` prop expects a string icon name (e.g., `"play"`, `"cross"`), not a React node.

**Workaround**: Use built-in icon names or cast React components with `as any`.

```typescript
// ✅ Works
<IconButton icon="play" />

// ⚠️ Workaround (type unsafe)
<IconButton icon={(<IconPlayerPlay size={16} />) as any} />

// ❌ Ideal API (not supported)
<IconButton icon={<IconPlayerPlay size={16} />} />
```

**Affected files**: `DBSearchPage.tsx` (SearchSubmitButton)

---

<!-- TODO: CLICK-UI-ICONBUTTON-HTML-TYPE -->
#### No HTML `type="submit"` support

**Issue**: The `type` prop is used for visual styling (`"primary" | "secondary" | "ghost" | "danger" | "info"`), which conflicts with HTML's `type` attribute for form submission.

**Workaround**: The form must handle submission via its `onSubmit` handler instead of relying on a submit button.

```typescript
// ❌ Not supported
<IconButton type="submit" />

// ⚠️ Spread workaround (overrides visual type)
<IconButton {...({ type: 'submit' } as any)} />

// ✅ Handle in form's onSubmit instead
<form onSubmit={handleSubmit}>
  <IconButton icon="play" /> {/* No type="submit" */}
</form>
```

**Affected files**: `DBSearchPage.tsx` (SearchSubmitButton)

---

<!-- TODO: CLICK-UI-ICONBUTTON-DYNAMIC-COLOR -->
#### No dynamic color support

**Issue**: IconButton doesn't support conditional/dynamic colors based on state.

**Original Mantine behavior**:
```typescript
<ActionIcon color={isFormStateDirty ? 'green' : 'gray'} />
```

**Click UI limitation**: No equivalent API. The `type` prop provides fixed visual variants only.

**Affected files**: `DBSearchPage.tsx` (SearchSubmitButton - `isFormStateDirty` prop is now unused)

---

### Button

<!-- TODO: CLICK-UI-BUTTON-SIZE -->
#### No `size` prop

**Issue**: Click UI Button doesn't have a `size` prop for compact/small buttons.

**Workaround**: Use CSS/style overrides or wait for Click UI to add size support.

```typescript
// ❌ Not supported
<Button size="xs" />

// ⚠️ Current workaround - add TODO comment
<Button
  // TODO: CLICK-UI size="xs"
  ...
/>
```

**Affected files**: `DBSearchPage.tsx` (multiple buttons)

---

<!-- TODO: CLICK-UI-BUTTON-HTML-TYPE -->
#### `type` prop conflicts with HTML type

**Issue**: Same as IconButton - the `type` prop is for visual styling, not HTML button type.

**Workaround**: Use `onClick` handler instead of form submission.

```typescript
// ❌ Can't use type="submit" with visual type
<Button type="primary" type="submit" />

// ✅ Use onClick to trigger submission
<Button
  type="primary"
  onClick={() => handleSubmit(onSubmit)()}
>
  Save
</Button>
```

**Affected files**: `DBSearchPage.tsx` (SaveSearchModalComponent)

---

<!-- TODO: CLICK-UI-BUTTON-ICON-PROP -->
#### `iconLeft`/`iconRight` expect IconName string

**Issue**: Icon props expect string icon names, not React components.

**Workaround**: Cast with `as any`.

```typescript
// ✅ Works
<Button iconLeft="bolt" />

// ⚠️ Workaround
<Button iconLeft={(<IconBolt size={14} />) as any} />
```

**Affected files**: `DBSearchPage.tsx` (ResumeLiveTailButton, tags button)

---

### Popover

<!-- TODO: CLICK-UI-POPOVER-TRIGGER-WIDTH -->
#### `Popover.Trigger` has `width: fit-content` by default

**Issue**: The `Popover.Trigger` component applies `width: fit-content` via styled-components, which prevents it from expanding to fill available space in flex layouts. This breaks cases where the trigger (e.g., an input field) should stretch horizontally.

Additionally, `Popover.Trigger` always wraps children in an internal `<div>`, even when `asChild` is passed (the `asChild` is forwarded to the underlying Radix component, but the cui wrapper div remains).

**Workaround**: Pass `style={{ width: '100%' }}` to `Popover.Trigger` to override the default width.

```typescript
// ❌ Input won't stretch
<Popover>
  <Popover.Trigger>
    <TextAreaField ... />
  </Popover.Trigger>
</Popover>

// ✅ Works - override width
<Popover>
  <Popover.Trigger style={{ width: '100%' }}>
    <TextAreaField ... />
  </Popover.Trigger>
</Popover>
```

**Affected files**: `AutocompleteInput.tsx`

---

### Select

<!-- TODO: CLICK-UI-SELECT-NOT-WORKING -->
#### Click UI Select dropdown does not open

**Issue**: The Click UI `Select` component's dropdown does not open when clicked. The component renders but clicking on it does nothing.

**Status**: ❌ **NOT MIGRATED** - Keeping Mantine Select until this is resolved.

**Attempted approaches**:
1. Using `options` prop with array of `{value, label}` objects
2. Using `Select.Item` children instead of `options` prop
3. Both approaches result in a non-functional dropdown

**Possible causes**:
- Internal Popover/Radix state management issue
- Z-index or portal configuration needed
- Missing required props or setup

**Current workaround**: Continue using Mantine `Select` component.

```typescript
// ❌ Click UI Select - dropdown doesn't open
import { Select } from '@clickhouse/click-ui';
<Select options={[...]} onSelect={...} />

// ✅ Mantine Select - works correctly
import { Select } from '@mantine/core';
<Select data={[...]} onChange={...} />
```

**Affected files**: `SelectControlled.tsx` (kept as Mantine)

---

## Search Tags for Future Fixes

When Click UI releases fixes for these issues, search for these tags to find affected code:

| Tag | Issue |
|-----|-------|
| `TODO: CLICK-UI` | General Click UI migration TODOs |
| `CLICK-UI-ICONBUTTON-ICON-PROP` | IconButton icon prop should accept ReactNode |
| `CLICK-UI-ICONBUTTON-HTML-TYPE` | IconButton needs htmlType prop for form submission |
| `CLICK-UI-ICONBUTTON-DYNAMIC-COLOR` | IconButton needs dynamic color support |
| `CLICK-UI-BUTTON-SIZE` | Button needs size prop |
| `CLICK-UI-BUTTON-HTML-TYPE` | Button needs htmlType prop for form submission |
| `CLICK-UI-BUTTON-ICON-PROP` | Button icon props should accept ReactNode |
| `CLICK-UI-POPOVER-TRIGGER-WIDTH` | Popover.Trigger should not have `width: fit-content` |
| `CLICK-UI-SELECT-NOT-WORKING` | Select dropdown doesn't open - not migrated |

---

## Components Successfully Migrated

| Component | Click UI Equivalent | Notes |
|-----------|---------------------|-------|
| `Popover` | `Popover` | Different API: `open`/`onOpenChange` vs `opened`/`onChange`. **Note**: Trigger has `width: fit-content` - override with `style={{ width: '100%' }}` |
| `Textarea` | `TextAreaField` | `onChange` receives value directly, not event |
| `Button` | `Button` | Use `type` for visual style, not HTML type |
| `UnstyledButton` | Native `<button>` | No direct equivalent, use styled native button |
| `Select` | ❌ Not migrated | Click UI Select dropdown doesn't open - keeping Mantine |

---

## Files Affected

- `packages/app/src/DBSearchPage.tsx`
- `packages/app/src/AutocompleteInput.tsx`
- `packages/app/src/SearchInputV2.tsx`
- `packages/app/src/components/SelectControlled.tsx`

---

## Version Info

- `@clickhouse/click-ui`: `0.0.248-rc.1`
- `styled-components`: `^6.3.5` (installed) - Note: Click UI requests `6.2.1-prerelease.0` but `6.3.5` works
