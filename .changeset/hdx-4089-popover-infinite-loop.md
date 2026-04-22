---
'@hyperdx/app': patch
---

Fix hard crash (React error #185 — "Maximum update depth exceeded") when
navigating to the Search page in production. The crash was caused by
Mantine `Popover`'s internal `reference`/`floating` `useCallback`s depending
on `popover.floating.refs.setReference`/`setFloating`. When those callback
identities changed across renders, React 19 invoked them with `null` and
then again with the node, which (via `useMergedRef`) triggered
`setTargetNode(null) → setTargetNode(node)` on every render and looped
until React bailed out with error #185.

Applied via a `yarn patch` on `@mantine/core` 9.0.0 that stabilizes the
`reference` and `floating` callback identities using `useRef`, which is
the same approach used upstream for similar ref patterns. The behavior is
unchanged for consumers of `Popover`, `Menu`, `Tooltip`, etc., but the
callbacks no longer get torn down and recreated between renders.
