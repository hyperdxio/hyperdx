---
'@hyperdx/app': patch
---

fix: the time picker no longer resets a selected date range to the current
year. Range text now always includes the year, so it survives being re-parsed.
