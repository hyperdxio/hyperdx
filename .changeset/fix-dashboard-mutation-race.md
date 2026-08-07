---
"@hyperdx/app": patch
---

Fix remote dashboard changes being silently lost when two edits are saved in
quick succession. `useUpdateDashboard` now optimistically updates the
`dashboards` query cache in `onMutate` (with rollback on error), so a following
`setDashboard` derives its update from the latest state instead of a stale
pre-mutation snapshot whose PATCH would overwrite the earlier change.
