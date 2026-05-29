---
'@hyperdx/app': patch
---

feat(dashboards): multi-select tag filter on Dashboards and Saved Searches; each item renders once

The single-tag dropdown on the Dashboards and Saved Searches list pages
is now a multi-select chip filter. Selecting multiple chips returns the
union of matching items (OR semantics), and each item renders exactly
once in the grid even when it carries multiple selected tags. URL state
moves to `?tags=a,b`; existing `?tag=foo` links continue to load and
migrate onto the new state on mount.
