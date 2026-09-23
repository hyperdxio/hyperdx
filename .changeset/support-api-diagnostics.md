---
'@hyperdx/api': patch
---

Operators can pull a process report, CPU profile and sampling heap profile from
a running API through `/diagnostics` after setting
`HDX_DIAGNOSTICS_ENABLED=true`. Full heap snapshots also need
`HDX_DIAGNOSTICS_HEAP_SNAPSHOT=true`: a snapshot is raw process memory,
including secrets and decrypted tokens, and it pauses the process and can
double its memory.
