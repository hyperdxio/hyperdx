---
"@hyperdx/common-utils": patch
"@hyperdx/app": patch
---

fix(search): wrap DateTime column values in parseDateTime64BestEffort when building IN/NOT IN filters so including/excluding a timestamp value no longer fails with "Cannot convert string ... to type DateTime64"
