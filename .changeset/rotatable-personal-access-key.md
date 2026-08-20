---
'@hyperdx/api': patch
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

Add a Rotate action for the personal API access key in Team Settings → API & Agents. Previously the personal access key — the bearer token for the external API v2 and the MCP server — was generated once at account creation and could never be changed, so a leaked key could only be remediated by deleting the user. Rotating immediately revokes the previous key, so MCP / AI agent configs, external API v2 clients, Terraform / IaC providers, and CI scripts using the old key must be updated with the new one. Browser sessions are unaffected.
