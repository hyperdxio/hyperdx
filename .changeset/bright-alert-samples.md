---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

Apply saved-search filters to sample events included in alert notifications.

Numeric group columns now remain part of the alert history key instead of
being mistaken for the threshold value. On the first evaluation after this
upgrade, an already-firing numeric-group alert may emit one resolution for its
legacy group key before emitting notifications under the corrected keys. The
legacy key is empty for a numeric-only group, or lacks the numeric dimension
for a composite group.
