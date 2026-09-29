---
'@hyperdx/app': patch
---

fix: label Map attribute columns added from the search sidebars by their key

Adding a Map attribute such as `ResourceAttributes['service.name']` as a column
from the filters sidebar or the row side panel now writes it into the SELECT as
`ResourceAttributes['service.name'] AS "service.name"`, so the results column
reads `service.name` instead of
`arrayElement(ResourceAttributes, 'service.name')`. The alias is visible and
editable in the SELECT, and queries typed by hand are not changed. A key named
like a table column, or one already used as a name in the SELECT, is added
without an alias.
