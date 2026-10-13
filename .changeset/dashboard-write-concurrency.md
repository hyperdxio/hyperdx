---
'@hyperdx/api': minor
'@hyperdx/app': minor
---

Dashboard writes are now guarded against concurrent edits, so a client working
from stale state is rejected instead of silently overwriting someone else's
change. The version token is a new integer counter maintained by schema
middleware, not the dashboard's `updatedAt` — that keeps the display field free
of a correctness role and gives new write paths the guard automatically.

**Breaking for MCP clients:** `clickstack_get_dashboard` and
`clickstack_save_dashboard` now return a `version`, and
`clickstack_get_dashboard_tile` returns it as `dashboardVersion`.
`clickstack_save_dashboard` (when updating) and `clickstack_patch_dashboard`
(always) now require it — an agent that omits `version` on an update gets an
error telling it to re-read and re-apply, where it previously got a silent
clobber.

The external API v2 `PUT /api/v2/dashboards/:id` endpoint honours an optional
`If-Match` header, and `GET`/`POST`/`PUT` all return an `ETag`. A mismatch is a
412 and a malformed header is a 400, but omitting `If-Match` keeps the old
last-write-wins behaviour, so the terraform provider is unaffected. The internal
`PATCH /api/dashboards/:id` route accepts an optional `expectedVersion` and
answers with a 409 and the current version on a mismatch.

The app now sends this token on save, seeds its query cache from the response,
serialises saves per dashboard, and on a 409 refetches and shows a toast
explaining the change wasn't saved and the latest version has been loaded.

This guards dashboard-document writes specifically, not every way a dashboard
can change: tile alerts live in a separate collection that doesn't bump the
dashboard's version, so a concurrent alert add/edit and dashboard save can still
race on the internal PATCH route (pre-existing behaviour, unaffected by this
change either way).

A dashboard that predates this change has no `version` field in MongoDB, and
the guard treats that the same as `version: 0` rather than as a permanent
conflict, so every write path keeps working with or without the included
migration having run. A `migrate-mongo` migration backfilling `version: 0` on
those documents is included in `packages/api/migrations/mongo/`, but nothing
in this repo invokes `migrate-mongo` automatically — it is optional tidy-up,
not a deploy step this change depends on.
