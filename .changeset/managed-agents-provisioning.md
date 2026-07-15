---
'@hyperdx/api': minor
'@hyperdx/app': minor
---

feat: provision Claude Managed Agents from the HyperDX UI

Add a Managed Agents section under Team Settings → API & Agents (gated by
`HDX_MANAGED_AGENTS_ENABLED` / `NEXT_PUBLIC_HDX_MANAGED_AGENTS_ENABLED`). The
Anthropic API key is read from the server environment (`AI_API_KEY` with
`AI_PROVIDER=anthropic`, or the legacy `ANTHROPIC_API_KEY`); per-team,
UI-managed key storage is a downstream (EE) concern injected via the
`resolveAnthropicKey` extension seam. A team can provision an opinionated
ClickStack SRE agent in one click — HyperDX creates the Anthropic environment,
vault (with the provisioning user's ClickStack access key as the MCP
credential), and agent with the ClickStack MCP server pre-configured, then
stores the references for management.
