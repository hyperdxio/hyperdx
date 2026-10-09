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

On Explore, the panel opens at 60% of the viewport instead of 80% and remembers
a width you set. Search, dashboards, and the session player keep the 80% default
and do not persist it.
