---
'@hyperdx/api': patch
---

Operators can now pull a process report, CPU profile and sampling heap profile
from a running API through `/diagnostics`, with no restart. Set
`HDX_DIAGNOSTICS_ENABLED=false` to turn the endpoints off; they are off by
default in the no-auth local image. Full heap snapshots stay off unless
`HDX_DIAGNOSTICS_HEAP_SNAPSHOT=true`, since they pause the process and can
double its memory.
