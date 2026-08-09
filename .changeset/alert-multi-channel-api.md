---
'@hyperdx/api': minor
---

Alerts can be configured with multiple notification channels (up to 10 webhooks) via the new `channels` field on the v2 external API, internal API, and the MCP `clickstack_save_alert` tool. The legacy singular `channel` field is still accepted on input and mirrored in responses, so existing integrations keep working unchanged.

Note that alert updates are a full replace, not a merge. A client that sends only the legacy `channel` field when updating an alert that has several channels will reduce it to that one channel — fetch the alert and resend the complete `channels` array to preserve them.
