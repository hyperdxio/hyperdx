---
'@hyperdx/app': patch
---

feat: preserve incompatible filters as an inactive state when switching data sources on the search page.

Previously, switching from Logs to Traces (or any other schema change) would silently drop filters whose fields don't exist on the new source. Now those filters stay visible in the `ActiveFilterPills` bar with a muted, strikethrough, dashed-border style and a tooltip explaining why they aren't applied. They are automatically excluded from the rendered query so it stays valid, and re-apply if the user switches back to a compatible source.

`ActiveFilterPills` accepts a new `invalidFields?: Set<string>` prop (with optional `invalidFieldReason?: (field: string) => string` for tooltip customization). `useSearchPageFilterState` accepts a new `validFields?: Set<string>` option and exposes `invalidFields` so consumers don't have to compute it themselves.
