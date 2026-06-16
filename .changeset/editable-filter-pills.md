---
"@hyperdx/app": patch
---

feat(search): make active filter pills editable in place

Clicking an active filter pill under the search bar now opens a small menu to copy the value, flip the filter polarity (include vs exclude), or switch to a different value of the same field, without removing and re-adding the filter. The polarity is preserved when changing the value, and the one-click remove on each pill is unchanged. Range and not-applied pills keep their remove-only behavior.
