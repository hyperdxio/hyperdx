---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

fix: refresh cached table columns after 5 minutes

The shared metadata cache kept each table's `DESCRIBE` result for the life of
the process, so the API did not see columns added with `ALTER TABLE`, such as
new MATERIALIZED columns, until it restarted. Cached columns now expire after 5
minutes. Other cached metadata is unchanged.
