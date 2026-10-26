---
'@hyperdx/app': patch
---

Make metric sources usable on the Explore page: drilling into a chart series now
carries that series over to the rows behind it, and the filter sidebar can
discover fields again.

Clicking one series of a metric chart previously landed on the Search page with
nothing but a time range — the group filters were discarded on the way out, so
"which pod is spiking" became "every log in the last hour". The clicked series
now travels with you, re-addressed against the destination source's own resource
attributes expression, so it still resolves when the two sources name their
attribute maps differently. Only resource attributes are carried: they identify
the emitting entity and OpenTelemetry keeps them consistent across signals,
whereas a metric's own data-point attributes could produce a filter that matches
nothing and reads as "this pod logged nothing". Drilling down from Explore also
stays on Explore now instead of handing the reader to the Search page.

The filter sidebar and the WHERE field's autocomplete were both empty for metric
sources. They read schema from `from.tableName`, which a metric source leaves
blank because its real tables are per metric type. Both now read the tables
behind the selected series. When a chart mixes metric types, field discovery
intersects them, since a sidebar filter applies to every series and offering a
field only one table has would break the others.
