---
'@hyperdx/api': patch
---

fix: Grouped alerts with many groups no longer slow down every alert check: the previous state of each group is read in one query with one index seek per group, instead of every history row of the last 7 days. The API builds a new AlertHistory index `{alert, group, createdAt, state}` at startup and then drops the `{alert, group, createdAt}` index it replaces. On a large AlertHistory collection the index build takes a while; checks keep using the old index until it is done.
