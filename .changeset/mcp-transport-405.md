---
'@hyperdx/api': patch
---

fix: MCP endpoint (`/api/mcp`) now returns 405 for GET and DELETE instead of aborting spec-compliant clients. The stateless Streamable HTTP transport doesn't offer a server-initiated SSE stream or client-terminable sessions, so it now responds `405 Method Not Allowed` (with `Allow: POST`) for those methods, which official MCP SDK clients (e.g. Claude Code) treat as "not offered, continue" rather than a failed connection.
