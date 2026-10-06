---
'@hyperdx/app': patch
---

fix(search): keep select-alias filters working when denoising results

Denoise mines event patterns from a rebuilt SELECT, so a filter on a column the
source exposes only under an alias (for example a default select of
`ServiceName as service`) failed with `Unknown expression identifier`. The
denoise pattern query now carries the same alias `WITH` clauses as the Event
Patterns view, and waits for them before it runs.
