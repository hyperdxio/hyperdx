---
'@hyperdx/app': patch
---

Event side panel: group by a field without leaving the panel. Hovering a row in
Column Values already offered "add to filters", which narrows to that one value;
the new action is the opposite move — the breakdown across every value of the
field — and toggles the same shared grouping the Explore toolbar drives, so the
two stay in step. It uses the same field expression as the column toggle, so a
map key groups as `ResourceAttributes['host.name']` rather than a second
spelling of the same field. Timestamps are skipped, since grouping on one gives
a group per row. Explore only, and hidden on cross-source rows, where there is
no grouping to change.

The hover actions on those rows now match the results table: discrete rounded
buttons on the row's own surface, with the product tooltip. They were a dark
translucent slab of joined segments over a hardcoded `rgb(0 0 0 / 20%)`, and
their labels came from the browser's native `title` tooltip. Being icon-only,
they also had no accessible name — in the results table either, which the shared
button now fixes for every caller.

The panel now opens at 60% of the viewport instead of 80%, and remembers a width
you set. Most of a row is short values, and at 80% the panel covered the results
list you were scanning through; the one field that wants the space, `Body`, wraps
at any width. Width previously reset on every reload because it was component
state, so the default was doing all the work.
