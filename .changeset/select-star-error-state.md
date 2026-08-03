---
'@hyperdx/app': patch
---

Improve the `SELECT *` error state shown when loading full row details from a
Distributed or Merge table whose target tables have mismatched columns. The
guidance now explains why HyperDX issues `SELECT *` in the first place and how a
Known Columns List resolves it, and the same error state now appears in expanded
log rows (previously they failed silently and rendered empty) in addition to the
row side panel.
