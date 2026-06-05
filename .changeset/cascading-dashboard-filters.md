---
'@hyperdx/app': patch
---

feat(dashboards): cascading (faceted) filter values

Dashboard filter dropdowns now narrow one another: selecting a value in one
filter constrains the options shown by the others to values that co-occur with
the current selection (e.g. picking a `cluster` limits the `namespace` dropdown
to namespaces in that cluster). This applies to both manually-created
dashboards and the bundled Kubernetes dashboard, where the dropdowns also honor
the free-text search. A filter never constrains its own options, so
multi-select within a single filter still works.
