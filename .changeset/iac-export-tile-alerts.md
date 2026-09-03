---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

Offer dashboard tile alerts for Terraform import. `clickhouse_clickstack_alert` gained `source = "tile"` with `dashboard_id`/`tile_id` in provider 3.26.0, so the bulk export and the per-alert menu now include tile alerts instead of skipping every alert that is not a saved-search one. A file carrying a tile alert asks for `>= 3.26.0` and explains the hand edit its generated config needs; an export without one still installs on 3.25.x. A tile alert is withheld when its tile has a blank or duplicated name — the provider's `tile_ids` map is keyed by tile name and omits those, so the alert could only be pinned to a literal id the next dashboard apply can re-mint — or when its dashboard is provisioned, since ProvisionDashboardsTask rewrites those tiles wholesale. Both decisions are made server-side, on the import manifest and on the alerts listing, because neither response carries a dashboard's sibling tile names.
