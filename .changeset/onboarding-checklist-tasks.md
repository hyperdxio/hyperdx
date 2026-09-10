---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

Add a context-aware getting-started checklist to the sidebar for recently-created teams. After the setup steps (connect ClickHouse, add data) complete, a second phase tracks product-usage milestones persisted per user on `user.onboardingData`: exploring data, building a dashboard, setting up an alert, and using the MCP server. Completion is recorded server-side so it counts from the UI, the external REST API v2, or an MCP tool; the card can be dismissed and reappears if a new task is added to the registry.
