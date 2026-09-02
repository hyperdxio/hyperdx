---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

Fixed single-series histogram charts failing with "Unknown expression or function identifier" when sorted by a group-by column or expression. The histogram translation packs group values into a single `group` Array, so the table default ORDER BY (the raw group-by text) referenced source columns that no longer exist in scope; matched sort items now address the packed array positionally.
