---
'@hyperdx/api': patch
---

Fix `{{sourceQuery}}` returning empty for inline-query and dashboard-tile
alerts. It read only the saved search's filter, so alerts backed by a chart
config — where the query lives on the alert or the tile — advertised a variable
that never rendered. It now resolves the query from whichever config backs the
alert: the builder `where` or the raw `sqlTemplate`.

Add `{{thresholdMax}}`, the upper bound of a `between` / `outside` condition.
Receivers previously saw only the lower bound and could not reconstruct the
range that fired. It renders empty for every other comparator.

Test Webhook now sends a sample value for every template variable. It carried
only the original seven, so a body using an enriched variable rendered it empty
— and because `threshold`, `thresholdMax` and `value` are emitted unquoted, a
body like `{"value": {{value}}}` was sent as `{"value": }` and rejected,
failing the test for a template that works on a real firing.
