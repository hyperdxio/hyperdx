---
'@hyperdx/common-utils': patch
---

fix: Keep string literals as written when rewriting `Map['key'] = 'value'` filters to the key-value items index, so values containing quotes or backslashes match instead of returning no rows
