---
'@hyperdx/app': patch
---

feat(dashboards): persist the filter link toggle and clarify within-source linking

The "link filters" toggle now remembers its state in browser storage — the
dashboard filter bar (shared across all dashboards and the Services page) and
the Kubernetes filter bar each keep their own preference — so it no longer has
to be re-enabled on every page load. Dashboard filters are now always displayed
grouped by source (preserving the defined order within each group), and while
link mode is on, small chain icons connect the filters that actually narrow
each other. Tooltips now spell out that only filters from the same source link
to each other — a selection can't narrow a dropdown whose values come from a
different source.
