---
"@hyperdx/app": patch
---

fix: Date picker calendar now respects timezone preference (HDX-4576)

When selecting a date from the calendar in the time picker, the time
previously defaulted to 00:00:00 UTC regardless of the user's "Use UTC
time" setting. Now calendar date picks correctly produce midnight in the
user's preferred timezone (local or UTC).
