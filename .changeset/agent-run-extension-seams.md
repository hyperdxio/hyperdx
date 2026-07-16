---
'@hyperdx/api': minor
'@hyperdx/app': minor
---

The managed-agent alert flow now exposes fail-open extension seams
(`onProvisionAgent`, `onSessionStart`, `onBeforeDelivery`, `resolveAnthropicKey`)
with a downstream-owned registration point and an `AgentRun.metadata` field, so
downstream distributions can extend investigations (e.g. notebook tracking) and
swap the agent's system and kickoff prompts wholesale without editing core
files. Claude webhooks now also honour their user-editable `body` template as
the agent's kickoff prompt (previously documented but ignored), falling back to
the built-in enriched payload for empty or broken templates.

The Anthropic API key for managed agents is now resolved from the environment
(`AI_API_KEY` with `AI_PROVIDER=anthropic`, or the legacy `ANTHROPIC_API_KEY`),
which is the sensible default for self-hosted deployments. The per-team,
UI-managed key (previously stored encrypted in MongoDB) has been removed from
open source and is now a downstream concern, injected through the
`resolveAnthropicKey` extension seam. With no extensions registered and the
default webhook body, behaviour is otherwise unchanged.
