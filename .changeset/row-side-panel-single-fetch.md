---
'@hyperdx/app': patch
---

fix: run the row details query once when opening a row

The side panel ran the same `SELECT *` row query twice: once for the panel, and
again when its Overview or Column Values tab mounted. A row that was found is
now reused from the cache, so the tab and later tab switches do not query it
again. A different row or source still runs the query, and a row that was not
found is looked up again.
