---
'@hyperdx/app': patch
---

Explore's Add filter popover can now build comparisons, not just equality. Pick
a numeric field and `>`, `>=`, `<` or `<=` join `is` and `is not`; text fields
keep the two they had, since a bound compiles to an unquoted literal and would
be invalid SQL against a string. A second bound narrows the existing one rather
than replacing it, so `>500` followed by `<=900` becomes a `BETWEEN`. This
reaches range filters that the pills, the SQL compiler and the search box could
already express — typing `Duration > 500` has always produced the same pill.
