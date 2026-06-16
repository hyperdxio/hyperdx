---
"@hyperdx/app": patch
---

feat: add a "Connect your AI assistant" section to Team Settings

A new section on the Team Settings page (Integrations tab, above the API Keys
card) lets a user install the HyperDX MCP server in Claude Code, Cursor,
VS Code + Copilot, Codex CLI, or any MCP-compatible host without hand-rolling
JSON. Per-host snippets carry the user's personal access key so the install
works against the existing `/api/mcp` route without extra setup.
