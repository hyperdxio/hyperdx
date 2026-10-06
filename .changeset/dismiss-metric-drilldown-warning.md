---
'@hyperdx/app': patch
---

feat: let users permanently dismiss the metric drill-down warning

Drilling down from a metric chart whose source has no correlated log source
shows a warning. Clicking its close button now hides the warning for good in
that browser, and repeated clicks no longer stack copies of it.
