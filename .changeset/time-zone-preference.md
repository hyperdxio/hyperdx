---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

refactor: Store the time display setting as a time zone instead of a UTC switch, converting existing settings, and remove the `isUTC` option from `formatDate`
