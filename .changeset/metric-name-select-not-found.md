---
'@hyperdx/app': patch
---

Fix two problems with the chart editor's metric name picker. The truncation and load-failure notices now render below the input instead of above it, so they no longer push the field down out of alignment with the browse-metrics button beside it, and both were shortened to fit the tile editor's column without wrapping. A search that matches nothing now says so rather than silently hiding the dropdown, and offers the searched name as a selectable option — the catalog only covers the most recent three days of the chart's time range, so a metric that stopped reporting was previously impossible to chart by name.
