---
'@hyperdx/app': patch
---

fix: show a loading placeholder instead of "No body for this event." while the
event is still loading

The event overview panel rendered the empty-body copy whenever the body was
falsy, including while the row fetch was still in flight, so the message flipped
to the real body once the request settled. The body paper now renders a skeleton
while `useRowData` is loading and only falls through to the empty-state copy
once the request settles with no body.
