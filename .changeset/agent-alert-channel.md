---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
---

feat: hand an alert's investigation to a Claude agent

An alert's notification channel can now be an agent instead of a webhook. When the alert fires, HyperDX starts an Anthropic session with a structured payload — status, comparator, threshold and its upper bound, current value, group key, source query, time range, and the alert's note as a runbook — and the agent investigates from there through the ClickStack MCP server. The result lives in that session; nothing is delivered from here, so the agent's own configuration decides where findings go.

Channels are additive, so a webhook still pages you immediately while the agent works the same incident. Sessions are deduped per alert, per agent, within a cooldown window, and the key is claimed before the Anthropic calls — so a grouped alert breaching on a thousand group keys starts one investigation rather than a thousand, and two concurrent firings cannot each pay for a session. Only the firing edge dispatches: the prompt says an alert fired, so investigating a resolution would be wrong as well as wasteful. A dispatch that fails is recorded against the alert as a distinct error naming the agent, and cannot consume another channel's notification slot.

Existing alerts are unaffected — the channel shape gates only what can be written, and nothing that used to validate stops validating. Agent channels require `HDX_MANAGED_AGENTS_ENABLED`, enforced once in shared validation so the internal API, the external API v2 and the MCP `saveAlert` tool cannot drift on what they accept.

Also fixes `{{note}}` in webhook templates, which always rendered empty because nothing ever set it.
