---
'@hyperdx/app': minor
'@hyperdx/api': minor
'@hyperdx/common-utils': minor
---

Make the max spans per trace limit configurable via a team-level setting and an optional per-user preference. The team setting sets the ceiling (admin-configurable under ClickHouse Client Settings), and individual users can set a lower personal limit in Preferences. The current default of 50,000 spans is preserved for teams and users that don't change it.
