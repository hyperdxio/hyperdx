---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

feat: AI agent alert investigations (agent notification channel + managed-agent provisioning)

Adds an `agent` alert notification channel type (🤖): when a firing alert has an
agent channel, a Claude managed-agent investigation session is started with a
structured, agent-ready payload (status, comparator, threshold, current value,
group key, source query, time range, runbook note). The agent investigates
through the ClickStack MCP server; the investigation runs (and its result
lives) in the Anthropic session, and the agent's own configuration decides
where findings go. Sessions are deduped per alert, per agent, within a
cooldown window — collapsing evaluation-window re-fires and grouped-alert
fan-out alike — so a level-triggered or high-cardinality alert cannot start
unbounded investigations. Agent channels sit alongside webhook channels, so
the immediate page and the investigation are independent targets on the same
alert. Agent dispatch failures are recorded as a distinct `AGENT_ERROR` alert
execution error naming the agent.

Each agent has a type — general, database, Kubernetes, application errors or
latency — whose brief is appended to the standing SRE prompt, so a team can run
a specialist alongside a general responder. The list names the creator whose
ClickStack access key the agent carries. Deleting an agent
removes its Anthropic agent, vault and environment before the local record, and
keeps the record if any of that fails so the teardown can be retried.

Agents are provisioned from Team settings → Integrations (environment + vault
holding the user's ClickStack access key + agent, with rollback on partial
failure). The agent auto-approves only the read-only ClickStack MCP tools, so
an unattended investigation cannot save or delete anything; it has no shell,
and its one outbound fetch — following a runbook link from the alert's note —
is evaluated per call rather than auto-approved; deleting an agent is refused
while an alert still targets it. Everything is gated behind `HDX_MANAGED_AGENTS_ENABLED` (off by default), and
provisioning a new agent needs a second opt-in,
`HDX_MANAGED_AGENTS_ALLOW_CREATE`, since it spends on the deployment's
Anthropic account and writes a user's ClickStack key into a vault — importing
an existing agent works without it. The Anthropic key is read from the server
environment. Fail-open
extension seams (`onProvisionAgent`, `onSessionStart`, `resolveAnthropicKey`)
let downstream distributions customise prompts and key resolution.

An agent created outside HyperDX can be imported by its Anthropic agent ID, for
teams that want to write the system prompt or tool set themselves. HyperDX
provisions the environment and vault the session needs so the credential
matches the instance, and verifies the ID before accepting it; removing an
imported agent tears those two down and leaves the agent itself alone.
