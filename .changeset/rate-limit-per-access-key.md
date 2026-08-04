---
'@hyperdx/api': patch
---

Key the external API and MCP rate limiters on the access key, not the raw
`Authorization` header

`validateUserAccessKey` accepts any text before `Bearer `, so a single access
key authenticates under unlimited header spellings. The limiter bucketed on the
header value, so varying that prefix handed each request a fresh quota. Requests
that carry no usable access key now fall back to the client IP.
