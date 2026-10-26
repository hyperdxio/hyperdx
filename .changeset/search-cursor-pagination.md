---
'@hyperdx/api': minor
'@hyperdx/common-utils': patch
---

Add cursor pagination to the external API v2 search endpoint: send `cursor: "start"`, then pass back each `nextCursor` until it is `null`. Cursors are signed with `EXPRESS_SESSION_SECRET`: replicas need a shared value, and rotating it invalidates outstanding cursors.
