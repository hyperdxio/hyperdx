---
"@hyperdx/api": patch
---

fix: allow creating and editing Sources in Local App Mode

In Local App Mode (`IS_LOCAL_APP_MODE`) the auth middleware injects a plain
string team id onto the request instead of a Mongoose `ObjectId`. The sources
router's create/update handlers called `teamId.toJSON()`, which only exists on
`ObjectId`, causing an HTTP 500 (`TypeError: teamId.toJSON is not a function`)
when saving a Source. Use `teamId.toString()` instead, which works for both
string and `ObjectId` team ids.
