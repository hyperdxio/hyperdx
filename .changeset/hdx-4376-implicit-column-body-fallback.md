---
"@hyperdx/common-utils": patch
"@hyperdx/app": patch
"@hyperdx/api": patch
---

fix: bare-text Lucene search now falls back from Implicit Column Expression to
Body Expression on log sources

Previously, a log source configured with `bodyExpression` set but
`implicitColumnExpression` unset threw `Can not search bare text without an
implicit column set.` on every bare-token search, even though the row panel
rendered correctly using the body column.

Search now reuses the same one-way fallback that `getEventBody` already
implements: when no Implicit Column Expression is set, bare-text search runs
against the configured Body Expression. Trace sources are unchanged
(`spanNameExpression` is not a body equivalent for trace search).
