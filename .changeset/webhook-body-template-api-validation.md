---
'@hyperdx/api': patch
---

fix: reject generic and incident.io webhook body templates that don't compile
with a 400 on create, update, and test (internal API, External API v2, and MCP
`clickstack_save_webhook`). Add `POST /api/v2/webhooks/validate` to check a
webhook config without saving it, e.g. at Terraform plan time.
