---
'@hyperdx/app': patch
---

feat(dashboards): opt-in linked (faceted) filter values

Dashboard and Kubernetes filter bars gain a "link filters" toggle (the
bidirectional-arrow button at the end of the bar). When enabled, each filter
dropdown only shows values that co-occur with the other current selections —
e.g. picking a `cluster` narrows the `namespace` dropdown to namespaces in that
cluster (the K8s bar also factors in the free-text search). A filter never
constrains its own options, so multi-select still works. It is off by default
because contingent value lookups can't use the cheap per-key rollups and are
more expensive at scale; when on, all of a source's facets are computed in a
single `groupUniqArrayIf` scan rather than one query per filter. Search-page
filters are unaffected.
