---
'@hyperdx/app': patch
---

fix: the time picker no longer resets a selected date range to the current
year. The range text now includes the year when the range isn't in the current
year (or reaches into the future), so it survives being re-parsed.
