---
'@hyperdx/app': minor
---

feat: filter the LLM dashboard by end user

Adds a user filter alongside the existing session filter. It lists the distinct
users seen on LLM spans in the searched range and scopes every tab to the one
selected, including the Errors tab's correlated log events.

Users are resolved with the same cross-dialect expression the "Top Users" chart
groups by (`user.email`, `enduser.id`, `user.id`,
`ai.telemetry.metadata.userId`), so a value picked from the dropdown always
matches the rows that produced it. The selection lives in the URL, so a filtered
view can be shared.
