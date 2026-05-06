---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

feat: add optional note field to alerts

Adds a freeform note/reason field to alerts that supports markdown formatting,
allowing on-call responders to document why an alert exists, threshold decision
history, and links to runbooks.

- New `note` field on the Alert model (optional, max 4096 chars, supports
  markdown)
- Note textarea in both the saved-search alert modal and the dashboard tile
  alert editor
- Notes displayed on the /alerts page in a collapsible section (hidden by
  default) with full markdown rendering
- Alert tabs in the saved-search modal show a red bell icon when the alert is
  firing, replacing the webhook channel icon
- The Alerts button on the search page shows a red bell icon when at least one
  alert in the saved search is firing
- External API v2 updated with `note` field in OpenAPI docs
