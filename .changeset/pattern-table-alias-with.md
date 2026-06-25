---
'@hyperdx/app': patch
---

fix(search): keep select-alias filters working in Event Patterns

Filtering on a column the source exposes only under an alias (for example a
default select of `ServiceName as service`) failed in the Event Patterns view
with `Unknown expression or table expression identifier 'service'`. The
results table works because its own SELECT defines the alias, but Event
Patterns rebuilds the SELECT and did not carry the alias definitions. The
pattern query now receives the same alias `WITH` clauses already threaded into
the results, histogram, and heatmap queries, so the filter resolves.
