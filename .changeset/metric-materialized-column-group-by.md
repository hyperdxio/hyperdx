---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: allow grouping gauge and sum metric charts by materialized and alias columns

Grouping or selecting a MATERIALIZED or ALIAS column on a gauge or sum metric chart failed with `Unknown expression identifier`, because the intermediate query didn't carry those columns through.
