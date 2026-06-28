---
'@hyperdx/api': minor
'@hyperdx/app': minor
---

feat: provision Claude Managed Agents from the HyperDX UI

Add a Managed Agents section under Team Settings → API & Agents (gated by
`HDX_MANAGED_AGENTS_ENABLED` / `NEXT_PUBLIC_HDX_MANAGED_AGENTS_ENABLED`). A team
stores its Anthropic API key (encrypted at rest via AES-256-GCM using
`HDX_ENCRYPTION_KEY`) and can provision an opinionated ClickStack SRE agent in
one click — HyperDX creates the Anthropic environment, vault (with the
provisioning user's ClickStack access key as the MCP credential), and agent with
the ClickStack MCP server pre-configured, then stores the references for
management. The Anthropic key is never returned by the API (masked, with a
4-char hint). No agent runtime/session handling is included yet.
