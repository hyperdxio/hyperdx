---
'@hyperdx/api': patch
---

Scope `DELETE /team/invitation/:id` to the caller's team. It previously deleted by id alone, so any authenticated user could revoke another team's pending invitation if they knew its id. Unknown or out-of-team ids now return 404.
