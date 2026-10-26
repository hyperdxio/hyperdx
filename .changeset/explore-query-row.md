---
'@hyperdx/app': patch
---

Explore's query bar is one row: the search field now sits beside the time range,
Live and Run instead of below them. A filter addon on the field's left edge
marks it as the thing that narrows results and opens the syntax reference, so
the row needs no separate help icon, and Add filter is icon-only beside it.
Explore's own "Show filters" button gives up the funnel it had borrowed and
matches the arrow it collapses with, as it already does on Search.

The field is SQL-only — Lucene is still rendered for saved searches that use it,
but is no longer something you can author here. The raw query is now reached
through a "Query editor" code icon sitting outside the field, rather than a
button labelled "SQL" within it: the query is the larger thing, with the field
spliced into it wherever `$__filters` appears, and naming the surface instead of
its contents leaves room for sources whose query is not SQL.
