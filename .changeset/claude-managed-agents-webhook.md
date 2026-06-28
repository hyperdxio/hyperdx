---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

feat: add Claude Managed Agents webhook template with enriched, agent-ready payload

Adds a "Claude Managed Agents" webhook service type that posts an enriched,
agent-ready JSON payload (sent identically to a Generic webhook). The pre-built
body carries structured alert context (status, type, comparator, threshold,
current value, group key, source query, team id, time range) and a prompt
instructing the agent to investigate via its pre-configured ClickStack MCP
server and post a root-cause summary. No MCP URL or auth is sent in the
payload — the agent reaches ClickStack through the MCP server declared on the
agent with credentials held in a vault.

These enriched template variables (`{{status}}`, `{{alertType}}`,
`{{comparator}}`, `{{threshold}}`, `{{value}}`, `{{groupKey}}`,
`{{sourceQuery}}`, `{{teamId}}`, `{{alertId}}`, `{{note}}`) are also available to
Generic webhook bodies for pre-agent routing and dedup. The alert's freeform
`note` is surfaced as `context.runbook` so a runbook link attached to the alert
reaches the agent.
