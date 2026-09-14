# AI agent alert investigations

Let a [Claude managed agent](https://platform.claude.com/docs/en/managed-agents/overview)
investigate your alerts: add an agent as a 🤖 notification channel and each
firing starts an investigation session. The agent reaches your telemetry
through the ClickStack MCP server, re-runs the alert's source query over its
time range, inspects related logs, traces and metrics, and produces a
root-cause summary.

```
ClickStack alert ──fires──▶ agent notification channel
                                   │ POST /v1/sessions (deduped per firing)
                                   ▼
                          Claude managed agent ──MCP──▶ ClickStack /api/mcp
                                   │
                                   ▼
                          Investigation session (root-cause summary)
```

The investigation runs — and its result lives — in the Anthropic session. Where
findings go from there is your agent's own configuration: add Slack, GitHub or
other credentials to the agent's vault and extend its instructions, or pick the
session up in the Claude console. HyperDX starts the investigation; it does not
deliver the result.

An agent channel is additive: keep your normal webhook channel on the same
alert for the immediate page, and add the agent channel for the investigation.

## Setup

### 1. Enable the feature and set the Anthropic key

The feature is off by default. Set these in the API server's environment and
restart it — the values are read at process start. For local development put
them in `packages/api/.env.development` (or export them in the shell before
`yarn dev`; exported values win over the file). Both the API server and the
check-alerts task read them:

| Variable | Required | Notes |
| --- | --- | --- |
| `HDX_MANAGED_AGENTS_ENABLED` | yes | `true` to enable the agent channel and the AI agents section. |
| `HDX_MANAGED_AGENTS_ALLOW_CREATE` | no | `true` to allow provisioning new agents from the UI. Off by default: creating one spends on the deployment's Anthropic account and writes a user's ClickStack key into a vault. Importing an existing agent works without it. |
| `AI_API_KEY` + `AI_PROVIDER=anthropic` | one of these | Provider-agnostic AI config. The key is only used for managed agents when the provider is explicitly `anthropic`. |
| `ANTHROPIC_API_KEY` | one of these | Legacy Anthropic-specific key. |
| `HDX_MANAGED_AGENTS_MCP_URL` | local dev only | Anthropic's cloud sandbox connects to your MCP server directly, so the URL must be public HTTPS. In production `FRONTEND_URL` + `/api/mcp` is used; locally, point this at a tunnel (e.g. ngrok) to your instance's `/api/mcp`. |

Set `NEXT_PUBLIC_HDX_MANAGED_AGENTS_ENABLED=true` on the app so the UI renders
the agent sections, and `NEXT_PUBLIC_HDX_MANAGED_AGENTS_ALLOW_CREATE=true` if
you set the API's create flag — otherwise the dialog offers import only.

### 2. Create an agent

Team settings → **Integrations** → **AI agents** → **Add agent** → **Create
new**. This provisions, on your Anthropic account:

- an **environment** (cloud sandbox the agent runs in),
- a **vault** holding your personal ClickStack API access key as a bearer
  credential for the MCP server (the model never sees the token — Anthropic's
  credential proxy injects it by matching the MCP URL),
- the **agent**, with the ClickStack MCP server pre-configured and its
  read-only tools auto-allowed so an unattended session doesn't stall waiting
  for approval. Only read tools are on that allowlist: the MCP server also
  exposes `clickstack_save_*`, `clickstack_delete_*` and
  `clickstack_patch_dashboard`, which stay at `always_ask` and therefore never
  run in a session nobody is watching.

Anthropic's built-in toolset is configured tool by tool rather than left at
its defaults, which auto-allow everything — including a shell. There is no
shell: the sandbox has network access, and a per-call check cannot reliably
judge a command that runs a script the agent wrote a moment earlier.
Investigating is querying, which the MCP tools do. `web_search` is off for the
same reason and because nothing asks the agent to search the web. `web_fetch`
is set to `auto` so the agent can follow a runbook you linked in the alert's
note, with Anthropic evaluating each fetch; a fetch it won't clear stops that
investigation, since nothing here answers an approval prompt. The file tools
stay on — the container is per-session and holds only what the agent puts in
it.

Pick a **type** to give the agent a starting brief — database, Kubernetes,
application errors, latency, or a general responder that adds nothing beyond
the standing prompt. The brief is shown under the picker and appended to that
prompt, so an agent can specialise in where to look first. It is baked into the
agent at creation, so changing it means recreating the agent.

Provisioning first verifies the MCP URL is reachable and accepts your access
key, and rolls the Anthropic resources back if a later step fails. Deleting an
agent also deletes its vault and environment; if any of them cannot be removed,
the agent is kept so you can retry rather than losing track of live resources.

The vault holds the ClickStack access key of whoever created the agent, so the
agent queries with that person's access — the list names the creator for this
reason.

#### Importing an agent you wrote yourself

To control the agent's system prompt, model or tools beyond what the form
offers, create it on Anthropic yourself — **Add agent** → **Import existing**
hides a `curl` that does it behind "Don't have one?" — and paste the returned
agent ID into that same tab. That `curl` carries the same tool policy HyperDX
provisions with, and it is the only thing that sets it: nothing inspects or
rewrites an imported agent's toolset, so an agent built with a looser policy
keeps it, and whatever you create is what runs unattended.

Only the ID is asked for, plus an optional label. The name and model are read
from the agent object itself rather than retyped, so they can't drift from what
Anthropic will actually run — the model in particular is display-only here,
since a session runs whatever the agent is configured with. HyperDX provisions
the environment and vault that a session needs, exactly as it does for an agent
it created, because the vault credential has to point at this instance's MCP
URL and carry a working ClickStack key; reusing whichever vault you happen to
have is the difference between an agent that reads your data and one that
silently can't. The import first checks the ID exists — an unknown ID is
rejected, and a check that fails for any other reason imports anyway and says
it is unverified.

Imported agents are marked in the list and behave like any other target.
Removing one deletes the environment and vault HyperDX provisioned and leaves
your agent on Anthropic.

Note that dispatch itself always needs an Anthropic key on the server, since
HyperDX starts every session through Anthropic's API. Distributions that want
that key neither on disk nor in the environment can implement the
`resolveAnthropicKey` extension seam and fetch it from a secret manager per
dispatch.

### 3. Add the agent to an alert

In any alert editor, add a notification target and pick the agent from the
list — webhooks and agents share one picker, so an alert can page a webhook
and hand the investigation to an agent at the same time. On each firing the
agent receives a structured payload:

```json
{
  "source": "clickstack",
  "schema_version": "1",
  "prompt": "A ClickStack alert fired. Investigate the root cause…",
  "alert": { "id": "…", "event_id": "…", "status": "firing", "type": "search", "title": "…", "body": "…", "link": "…" },
  "condition": { "comparator": ">=", "threshold": 5, "current_value": 42 },
  "context": {
    "group_key": "…",
    "source_query": "…",
    "runbook": "…",
    "team_id": "…",
    "time_range": { "start": "…", "end": "…" }
  }
}
```

The alert's freeform **note** is passed as `context.runbook` — use it to attach
a runbook link.

Alerts are level-triggered (they fire every evaluation window while breached),
so investigations are deduped per alert, per agent, within a 1-hour window:
re-fires — including additional breaching groups of a grouped alert — reuse
the existing session, and a firing in a later window gets a fresh
investigation. This bounds Anthropic spend to at most one session per alert
per agent per hour regardless of group cardinality.

## Webhook template variables

The same enriched fields are available as Handlebars variables in Generic and
incident.io webhook bodies, useful for routing or deduping in a receiver before
spending agent tokens. See
[`alert-webhook-template-variables.md`](alert-webhook-template-variables.md).

## References

- ClickStack MCP server: [`MCP.md`](../MCP.md)
- [Managed agents quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart)
- [Authenticate with vaults](https://platform.claude.com/docs/en/managed-agents/vaults)
- [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies)
