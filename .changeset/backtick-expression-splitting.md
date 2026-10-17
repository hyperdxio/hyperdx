---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

Keep backtick-quoted column names intact when splitting SQL expression lists.
Ignore SQL comment contents, including nested block comments and `//` comments,
when tracking quotes and brackets.
