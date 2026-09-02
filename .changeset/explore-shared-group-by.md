---
'@hyperdx/app': patch
---

Explore: group by is now one control in the toolbar, shared by the events and
chart views, instead of living inside the series panel. Grouping a chart by a
dimension and switching to events keeps the breakdown — the histogram restacks
on the same dimension rather than falling back to severity or status code — and
the control no longer moves when a second series is added. Hidden on Patterns,
which is already its own grouping, and on Number, which has nothing to split;
the value is kept and comes back on the way out. Traces with no status code
expression now default to grouping by service name in the histogram as well as
in charts, which previously disagreed.

Picking a dimension no longer means writing SQL. The control is a field picker
shaped like the columns picker beside it — searchable, multi-select, and
including nested map keys such as `ResourceAttributes['host.name']` — with a
SQL tab for groupings a field list cannot express. Grouping by more than one
dimension already worked and still does; the picker just makes it visible. The
control spells out `Group by SeverityText` in a labelled field, built as the
same left-addon shape as the `As <chart type>` picker beside it, rather than
leaving an icon to carry the word "group".
