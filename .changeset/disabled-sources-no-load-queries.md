---
"@hyperdx/app": patch
---

fix: Don't run ClickHouse queries for disabled sources on load. Disabled sources are now excluded from the metadata/field autocomplete and dashboard filter-value lookups that fire on page load, so loading a page no longer issues source-settings queries (e.g. `SELECT name, value FROM system.settings`) for sources that are turned off.
