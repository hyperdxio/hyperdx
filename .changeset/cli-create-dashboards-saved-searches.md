---
'@hyperdx/cli': minor
---

Add `hdx dashboards create --file <json>` and a new `hdx saved-searches` command group (`list` / `create`) so dashboards and saved searches can be created from the terminal. Dashboard definitions are validated locally against the shared schema before being sent, and missing tile ids are generated automatically. Also fixes `getSavedSearches()` to call the correct `/saved-search` API path (the previous `/saved-searches` path always returned 404).
