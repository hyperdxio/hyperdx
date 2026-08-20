---
"@hyperdx/common-utils": patch
"@hyperdx/api": patch
"@hyperdx/app": patch
---

Align alert firing/recovery chart markers with the evaluated data: markers are now drawn at the start of the newest evaluated bucket (matching the evaluation history table and the plotted data point) instead of at the evaluation time, which sat one bucket to the right.
