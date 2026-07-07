---
"@hyperdx/api": minor
---

Add CRUD REST endpoints for saved searches to the external API
(`/api/v2/saved-searches`), enabling infrastructure-as-code tooling to
provision saved searches programmatically. Deletes cascade to alerts that
reference the saved search, and create/update persist `createdBy`/`updatedBy`
audit metadata consistently with the internal API.
