---
'@hyperdx/api': minor
---

External API v2: make error responses consistent and add concurrency safety.

- `/api/v2/alerts` `403`/`404` responses now return a JSON `{ message }` body
  (previously an empty plaintext body), matching the documented `Error` schema
  and the saved-search/webhook routers.
- `DELETE /api/v2/alerts/:id` now returns `404` for an alert that does not exist
  (previously always `200`). The `404` was already part of the documented
  contract; delete is no longer idempotent for a missing alert.
- `PUT /api/v2/webhooks/:id` can now return `409` when the webhook's destination
  (`url`/`service`) was changed concurrently between read and write. Clients
  should re-read and retry.
