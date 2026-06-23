---
"@hyperdx/common-utils": patch
"@hyperdx/app": patch
---

fix(search): wrap date column values in a type-matching parse/convert expression when building IN/NOT IN filters, so including/excluding a timestamp value no longer fails with "Cannot convert string ... to type DateTime64" or "Type mismatch in IN ... Expected: DateTime. Got: Decimal64". Date column types are now resolved from the query result set, so aliased (`TimestampTime AS time`) and computed (`toDate(TimestampTime)`) DateTime/Date columns are also wrapped correctly when added to filters.
