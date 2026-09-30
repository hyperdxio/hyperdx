---
'@hyperdx/api': minor
'@hyperdx/common-utils': patch
---

Add cursor pagination to the external API v2 search endpoint. Pass the
`nextCursor` from a response back as `cursor` to fetch the next page; pages are
scoped to a time window instead of a growing `OFFSET`, so page cost no longer
grows with depth. The existing `offset` parameter is unchanged.

Keep requesting pages until `nextCursor` is `null` — a short page does not mean
the results are exhausted.
