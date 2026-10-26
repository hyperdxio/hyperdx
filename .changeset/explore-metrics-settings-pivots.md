---
'@hyperdx/app': patch
---

Add chart settings and contextual series actions to metric views in Explore.
Metric chart settings now survive shared URLs and carry into dashboard tiles.
Series menus can filter Explore in place or pivot to correlated logs and traces
for the selected time bucket. Explore series now filter through the same SQL
query editor as the page query bar, dropping the Lucene/SQL switch that Explore
never used, and read as "And where" when the page search already narrows every
series. A series filter builds queries the way the page bar does: a completed
clause promotes into a filter pill, "Add filter" offers the source's columns,
and the pills travel in shared links.
