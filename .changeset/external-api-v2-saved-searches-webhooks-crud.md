---
"@hyperdx/api": minor
---

External API v2: add bearer-auth CRUD for saved searches and webhooks so
providers can manage them as resources. Adds a new
`/api/v2/saved-searches` router (list/get/create/update/delete, team-scoped,
validates `sourceId` ownership) and upgrades `/api/v2/webhooks` from
list-only to full CRUD (POST/PUT/DELETE). Webhook `headers` and `queryParams`
are write-only — accepted on create/update but never returned on read — so
auth tokens and other secrets do not leak.
