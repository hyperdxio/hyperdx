---
'@hyperdx/api': minor
---

feat(mcp): add alert, saved search, and webhook MCP tools

Add five new MCP tools for managing alerts, saved searches, and webhooks:
- `hyperdx_get_alert` / `hyperdx_save_alert` for listing, creating, and updating alerts
- `hyperdx_get_webhook` for listing webhook destinations
- `hyperdx_get_saved_search` / `hyperdx_save_saved_search` for listing, creating, and updating saved searches

Also makes `McpContext.userId` required, rejecting MCP requests without a user ID.
