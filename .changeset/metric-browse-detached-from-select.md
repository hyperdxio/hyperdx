---
'@hyperdx/app': patch
---

On Explore, "Browse metrics" is a labelled button beside the metric name, not
an icon glued to the select. The tile editor keeps the icon button and can
still stage tag filters from the explorer.

Explore's explorer no longer stages WHERE clauses: filtering stays in the
attribute panel under the series. Applying a different metric still clears the
series filter, and the explorer says so before you commit — along with a
warning when a staged group by would replace the chart's existing one.
