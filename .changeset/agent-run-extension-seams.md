---
'@hyperdx/api': minor
---

The managed-agent alert flow now exposes fail-open extension seams
(`onProvisionAgent`, `onSessionStart`, `onBeforeDelivery`) with a
downstream-owned registration point and an `AgentRun.metadata` field, so
downstream distributions can extend investigations (e.g. notebook tracking)
and swap the agent's system and kickoff prompts wholesale without editing
core files. Claude webhooks now also honour their user-editable `body`
template as the agent's kickoff prompt (previously documented but ignored),
falling back to the built-in enriched payload for empty or broken templates.
With no extensions registered and the default body, behaviour is otherwise
unchanged.
