---
'@hyperdx/app': patch
---

Narrow "Browse metrics" to finding a metric, and detach it from the metric name
field. It was an icon-only addon glued to the select, which drew its own border
at 2px taller than the input so it sat visibly out of line, and which implied it
only picked a value for that field. It is now a labelled button beside the
select.

The explorer no longer stages WHERE clauses: filtering stays in the attribute
panel under the series, where the condition being edited is visible. Applying a
different metric still clears the series filter, since its clauses name
attributes the new metric does not have, and the explorer now says so in its
footer before you commit — along with a warning when a staged group by would
replace the chart's existing one.
