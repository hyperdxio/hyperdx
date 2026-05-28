---
"@hyperdx/app": patch
---

fix(row-panel): hide empty attribute sections and stop showing "[Empty]"
when the source's body column isn't configured

The row-expand side panel always rendered `Log/Span Attributes` and
`Resource Attributes` accordion sections, even when both were empty. The
body header fell back to a literal `[Empty]` paper in two visually
identical cases that meant different things: the body column was
configured but the value was empty, or the body column wasn't configured
on the source at all.

The two attribute accordions now mirror the existing `topLevelAttributes`
pattern and only render when their content is non-empty. The body header
takes a new `bodyConfigured` prop: when `false` (source has neither body
nor implicit column expression configured), the body paper is suppressed
entirely. When `true` and the content is empty, the placeholder reads
"No body for this event." instead of `[Empty]`.

`DBRowOverviewPanel` derives `bodyConfigured` from
`getEventBody(source) !== undefined`, which already returns `undefined`
when neither expression is set.

Fixes HDX-4373.
