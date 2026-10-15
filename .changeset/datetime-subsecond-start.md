---
'@hyperdx/common-utils': patch
---

fix: Floor the time filter start on second-precision DateTime columns so a sub-second start no longer drops the rest of that second
