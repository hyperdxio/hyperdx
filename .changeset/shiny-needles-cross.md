---
'@hyperdx/app': patch
---

fix(app): negative duration in search

Duration column in the search interface displayed negative numbers when only a
timestamp was present. This fix changes the behavior to display "N/A" for such
cases, clarifying that the duration is not applicable rather than displaying a
misleading negative number.
