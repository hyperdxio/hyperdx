---
'@hyperdx/api': patch
---

fix: Block generic and incident.io webhooks whose hostname resolves to a private or reserved address. The check runs on the address actually dialed, so it also covers DNS rebinding. Self-hosted setups that send webhooks to internal hostnames must add them to `WEBHOOK_HOSTNAME_ALLOWLIST`.
