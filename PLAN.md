# Fix: waterfall collapses under bottom-layout detail panel (PR #2693 review)

## Context

Greptile review comment [r3628068997](https://github.com/hyperdxio/hyperdx/pull/2693#discussion_r3628068997)
on `packages/app/src/components/DBTracePanel.tsx:423` (branch `karl/span-sidebar-feedback`):

> When the detail panel is in bottom layout, resizing it large leaves this pane with only
> `100 - bottomPanelSize` of the column height and `minHeight: 0`. … Once this outer pane
> becomes shorter than that chrome, the timeline area has no remaining height, so the trace
> chart is clipped or disappears while the detail pane still keeps its `200px` floor. The
> split needs to reserve a usable minimum height for the waterfall side too.

Confirmed in code: the waterfall pane (`DBTracePanel.tsx` ~line 421–429) has
`flex: ${100 - detailPanelSize} 1 0` with `minHeight: 0` / `overflow: hidden`, while the
detail pane (~line 487–500) gets `minHeight: 200` in bottom layout. The waterfall's fixed
chrome above the timeline (`DBTraceWaterfallChart.tsx`) is:

- `TimelineMinimap`: 52px (`TICK_HEIGHT 18 + BAR_AREA_HEIGHT 34`) + `mb="md"` ≈ **68px**
- Controls bar (`Group my="xs"`, 22px buttons) ≈ **42px**
- (optional) filters form / highlighted-attributes list — variable

So below ~110px the timeline (`flex: 1` wrapper) has zero height and the chart disappears,
while the divider can still be dragged further because `useResizable`'s clamp is
window-relative, not container-relative.

## Approach

CSS-only fix, symmetric with the detail pane's existing floor: give the waterfall pane its
own minimum size when a span is selected. Flexbox won't shrink an item below its
`min-height`/`min-width`, so the split pins there even if `detailPanelSize` keeps growing —
exactly the same (already-shipped) behavior as the detail pane's `minWidth: 300` /
`minHeight: 200` floors. No changes to `useResizable` needed (its window-relative clamp is
imprecise for this nested container anyway; the CSS floor is the robust guard).

Floor value: **200px** in bottom layout — covers minimap (68) + controls (42) + ~4 timeline
rows (4 × 22 = 88). Matches the detail pane's 200px floor for symmetry.

Also apply the equivalent guard in side layout (`minWidth: 300`, matching the detail pane's
`minWidth: 300`), since the same collapse happens horizontally — the review comment says
"reserve a usable minimum … for the waterfall side too".

## Files to modify

- `packages/app/src/components/DBTracePanel.tsx` — waterfall pane style (~line 421–429), one change:

```tsx
<div
  style={{
    flex: selectedSpan ? `${100 - detailPanelSize} 1 0` : '1 1 100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: selectedSpan && isSideLayout ? 300 : 0,
    minHeight: selectedSpan && !isSideLayout ? 200 : 0,
  }}
>
```

(Keep `0` when no span is selected so the pane can still fill/shrink freely in the
single-pane state.)

## Reuse

- Existing floor pattern: detail pane already uses `minWidth: 300` / `minHeight: 200` in
  the same file — we mirror it, no new utilities.
- `useResizable` (`packages/app/src/hooks/useResizable.tsx`) stays untouched.

## Steps

- [ ] Add conditional `minWidth`/`minHeight` floors to the waterfall pane div in
      `DBTracePanel.tsx` (single style change above).
- [ ] Extend `packages/app/src/components/__tests__/DBTracePanel.test.tsx` (which already
      covers the layout toggle): assert the waterfall pane has `min-height: 200px` when a
      span is selected in bottom layout (and `min-width: 300px` in side layout).
- [ ] Reply to / resolve the Greptile thread on the PR after pushing.

## Verification

- `yarn workspace @hyperdx/app jest DBTracePanel` — existing + new tests pass.
- Manual (dev app or Vercel preview, per PR test steps): open a trace, select a span,
  toggle to bottom layout, drag the divider all the way up → the waterfall keeps ≥200px
  (minimap + controls + a few rows visible), timeline never disappears. Repeat in side
  layout dragging the divider fully left → waterfall keeps ≥300px width.
