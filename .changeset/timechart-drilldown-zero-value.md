---
'@hyperdx/app': patch
---

fix: drill down correctly from a time chart point with a value of 0

Clicking a point with a value of 0 searched every event in that time bucket. It
now filters to events with a value of 0, as it already did for any other value.
