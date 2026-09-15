---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
---

feat: provision and manage Claude agents for a team

A team can own Claude managed agents through `/api/managed-agents`. Provisioning creates the Anthropic pieces a session needs — an environment, a vault holding the creating user's ClickStack access key, and the agent itself — and rolls back whatever it made if a later step fails. An agent written by hand on Anthropic can be imported by its ID instead, and is rejected if it points at a different MCP server or none at all, since the credential provisioned for it would go unused and the agent would run with no ClickStack access. Deleting one tears down the remote resources before the local record and keeps the record if any of that fails, so a partial teardown can be retried; it is refused while an alert still targets the agent.

The agent's tool policy is written out rather than inherited. Anthropic's built-in toolset auto-approves every tool by default, so it is configured tool by tool: no shell, no web search, and a runbook fetch evaluated per call. Only the read-only ClickStack MCP tools are auto-approved, which matters because nothing answers an approval prompt in an unattended session — anything left asking simply never runs.

Everything is behind `HDX_MANAGED_AGENTS_ENABLED`, which 404s the whole surface when unset. Provisioning needs a second opt-in, `HDX_MANAGED_AGENTS_ALLOW_CREATE`, since it spends on the deployment's Anthropic account; importing works with the first flag alone. `HDX_MCP_ALLOWED_HOSTS` allowlists extra hostnames for the MCP endpoint, for a deployment that serves the API on a host of its own.
