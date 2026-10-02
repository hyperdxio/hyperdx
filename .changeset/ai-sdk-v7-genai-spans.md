---
'@hyperdx/api': patch
---

feat: upgrade the AI SDK to v7 and trace AI calls with GenAI semantic conventions

AI assistant calls now emit OpenTelemetry spans that follow the GenAI semantic conventions (`invoke_agent` / `chat` / `execute_tool` spans with `gen_ai.*` attributes) instead of the legacy `ai.*` span shape. Team and user attribution moves from `ai.telemetry.metadata.*` to `hyperdx.team.id` and `user.id` (plus `gen_ai.conversation.id` when a session is known). Saved searches, alerts or dashboards keyed on the old `ai.*` span names or attributes need updating.
