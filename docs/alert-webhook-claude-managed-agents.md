# Alert Webhook → Claude Managed Agents

Drive a [Claude Managed Agent](https://platform.claude.com/docs/en/managed-agents/overview)
from a ClickStack/HyperDX alert: when an alert fires, an agent investigates your
telemetry through the ClickStack MCP server, produces a root-cause summary, posts
it to Slack, and leaves a live session your on-call engineer can pick up.

```
ClickStack alert ──fires──▶ Generic webhook (Claude template)
                                   │
                                   ▼
                          Thin receiver (verify · dedup · start session)
                                   │ POST /v1/sessions
                                   ▼
                          Claude Managed Agent ──MCP──▶ ClickStack /api/mcp
                                   │ session.status_idled (outbound webhook)
                                   ▼
                          Receiver fetches result ──▶ Slack + handoff link
```

Claude Managed Agents has **no native inbound alert trigger**, so a small
receiver bridges the HyperDX webhook to the Managed Agents API. The receiver is
operationally critical (it fires on real incidents) but small: verify, dedup,
route, start a session.

---

## 1. The webhook payload HyperDX sends

In HyperDX, create a webhook under **Team Settings → Webhooks**, choose the
**Claude Managed Agents** service type, and point the URL at your receiver. The
body is pre-filled with an enriched, agent-ready JSON payload:

> **The payload carries no MCP URL or auth.** The agent reaches ClickStack
> through the MCP server pre-configured on the agent (§2), with the Bearer token
> held in a vault (§3) and injected by Anthropic outside the sandbox. Nothing
> secret is ever sent over the wire in the webhook.

```json
{
  "source": "clickstack",
  "schema_version": "1",
  "prompt": "A ClickStack alert fired. Investigate the root cause using your pre-configured ClickStack MCP server (logs, traces, metrics, and alert history). Reconstruct and re-run the alert source_query over the time_range, inspect related logs, traces, and metrics, follow the runbook in context.runbook if present, check recent deploys, then post a structured root-cause summary to Slack and leave the session open for the on-call engineer to continue.",
  "alert": {
    "id": "{{alertId}}",
    "event_id": "{{eventId}}",
    "status": "{{status}}",
    "type": "{{alertType}}",
    "title": "{{title}}",
    "body": "{{body}}",
    "link": "{{link}}"
  },
  "condition": {
    "comparator": "{{comparator}}",
    "threshold": "{{threshold}}",
    "current_value": "{{value}}"
  },
  "context": {
    "group_key": "{{groupKey}}",
    "source_query": "{{sourceQuery}}",
    "runbook": "{{note}}",
    "team_id": "{{teamId}}",
    "time_range": { "start": "{{startTime}}", "end": "{{endTime}}" }
  }
}
```

The body is a [Handlebars](https://handlebarsjs.com/) template. You can edit it
freely; the variables below are substituted at send time.

### Template variables

| Variable          | Example                       | Notes |
| ----------------- | ----------------------------- | ----- |
| `{{alertId}}`      | `663f…`                       | Stable alert id. |
| `{{eventId}}`      | `a1b2…`                       | Per-firing dedup hash (alert + channel + group). Use as an idempotency key. |
| `{{status}}`       | `firing` \| `resolved` \| `no_data` | Mapped from alert state; enables suppress-on-resolve and no-data handling. |
| `{{alertType}}`    | `search` \| `dashboard_chart` | Mapped from the alert source. |
| `{{title}}`        | `🚨 Alert for "5xx rate"…`     | |
| `{{body}}`         | rendered alert body           | Includes sample log lines for saved-search alerts. |
| `{{link}}`         | `https://hdx…/search/…`       | Deep link into HyperDX. |
| `{{comparator}}`   | `>=` `>` `<=` `<` `=` `!=` `between` `outside` | Threshold comparator. |
| `{{threshold}}`    | `5`                           | Numeric; quoted in the default body to keep JSON valid. |
| `{{value}}`        | `42`                          | The value that triggered/resolved the alert. |
| `{{groupKey}}`     | `checkout-service`            | Grouped-by value, when present. |
| `{{sourceQuery}}`  | `Body: "error"`               | The search expression / SQL defining the alert. JSON-escaped. |
| `{{note}}`         | `Runbook: https://wiki/…`     | The alert's freeform note — use it to attach a runbook link. Surfaced as `context.runbook`. |
| `{{teamId}}`       | `663f…`                       | Owning team. |
| `{{startTime}}` / `{{endTime}}` | epoch ms         | Evaluation window — scope MCP queries to it. |
| `{{state}}`        | `ALERT` \| `OK` \| `INSUFFICIENT_DATA` | Raw internal state (prefer `{{status}}`). |

> These variables are also available to the plain **Generic** webhook, so you can
> route/dedup by `service`/`severity`/`status` before spending agent tokens.

### Security

Add a shared-secret header in the webhook's **Headers** field and verify it in
the receiver. (A first-class signed-webhook — HMAC over the body with a per-
webhook secret + timestamp — is on the roadmap; until then, use a header secret
over HTTPS.)

---

## 2. Create the agent (once)

Declare the ClickStack MCP server at `<your-hyperdx-instance>/api/mcp`. This URL
lives only here and in the vault credential (§3) — it must be byte-identical in
both, and it is never sent in the webhook payload.

```bash
curl -sS https://api.anthropic.com/v1/agents \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{
    "name": "ClickStack SRE Responder",
    "model": "claude-opus-4-8",
    "system": "You are an SRE agent. A ClickStack alert fired. Investigate via the clickstack MCP server (logs/traces/metrics + alert history), reconstruct and re-run the alert source_query over the time_range, check recent deploys, then post a structured root-cause summary to Slack.",
    "mcp_servers": [
      { "type": "url", "name": "clickstack", "url": "https://<your-hyperdx-instance>/api/mcp" }
    ],
    "tools": [
      { "type": "agent_toolset_20260401" },
      { "type": "mcp_toolset", "mcp_server_name": "clickstack" }
    ]
  }'
```

Save the returned `agent_id`.

**Tool permissions** default to `always_ask`. For an unattended loop, auto-allow
the read tools via `default_config`/`configs` on the `mcp_toolset`, and keep
write/remediation tools disabled until precision is validated (read-only first).
See [permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies).

Create an environment once and save its `environment_id`:

```bash
curl -sS https://api.anthropic.com/v1/environments \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{ "name": "sre-sandbox", "config": { "type": "cloud", "networking": { "type": "unrestricted" } } }'
```

---

## 3. Store secrets in a vault (once)

The model never sees the token — Anthropic's credential proxy injects it by
matching `mcp_server_url` to the agent's MCP server `url`. **Same exact URL.**

```bash
# create the vault → save vault_id
curl -sS https://api.anthropic.com/v1/vaults \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{ "display_name": "ClickStack SRE Credentials" }'

# add the ClickStack Personal API Access Key (Team Settings → API Keys)
curl -sS https://api.anthropic.com/v1/vaults/$VAULT_ID/credentials \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{
    "display_name": "ClickStack Personal API Access Key",
    "auth": {
      "type": "static_bearer",
      "mcp_server_url": "https://<your-hyperdx-instance>/api/mcp",
      "token": "<personal-api-access-key>"
    }
  }'
```

Add Slack / GitHub credentials to the same vault as needed (least privilege:
read-only ClickStack, Slack write scoped to one channel).

---

## 4. The receiver (per alert)

A small HTTPS service: verify the shared-secret header, dedup on
`alert.event_id` within the firing window, then start a session and hand it the
payload as the prompt.

```js
// 1. verify header secret, 2. dedup on payload.alert.event_id, then:
const headers = {
  'x-api-key': process.env.ANTHROPIC_API_KEY,
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
  'content-type': 'application/json',
};

const session = await fetch('https://api.anthropic.com/v1/sessions', {
  method: 'POST', headers,
  body: JSON.stringify({
    agent: AGENT_ID,
    environment_id: ENV_ID,
    vault_ids: [VAULT_ID],
    title: payload.alert.title,
  }),
}).then(r => r.json());

await fetch(`https://api.anthropic.com/v1/sessions/${session.id}/events`, {
  method: 'POST', headers,
  body: JSON.stringify({
    events: [{ type: 'user.message', content: [{ type: 'text', text: JSON.stringify(payload) }] }],
  }),
});
```

The enriched body is already agent-ready — `condition` and `context` tell the
agent what to query without a round-trip. It reaches ClickStack through its
pre-configured MCP server, so the payload never carries an MCP URL or token.

---

## 5. Return the result to Slack

Register an outbound webhook in the Claude console (**Manage → Webhooks**) for
`session.status_idled`. On receipt, verify the signature (HMAC-SHA256 over the
raw body) and fetch the result:

```python
import anthropic
client = anthropic.Anthropic()  # reads ANTHROPIC_WEBHOOK_SIGNING_KEY

event = client.beta.webhooks.unwrap(request_body, headers)  # raises on bad sig / >5 min old
if event.data.type == "session.status_idled":
    events = client.beta.sessions.events.list(event.data.id)
    summary = next((e.content[0].text for e in events if e.type == "agent.message"), "")
    # post `summary` to Slack; include a deep link to the session for handoff
```

### Suggested Slack format

```
<Alert title> — <service> (<environment>)
Fired: <time>  ·  <comparator> <threshold> (now: <current_value>)

Hypothesis (confidence: Med): <one-line probable root cause>

Evidence
• Logs: <count> errors of <type> in <window> — <link>
• Trace: p99 <x>ms, slow span <service.op> — <link>
• Deploy: <sha> shipped <Δ> before onset — <link>

Suggested next steps
1. …   2. …

▶ Continue in the live agent session: <handoff link>
```

---

## The one thing that breaks it

The MCP URL appears in **two places** and they must be byte-identical (scheme,
host, path, no trailing-slash drift):

1. the agent's `mcp_servers[].url` (§2),
2. the vault credential's `auth.mcp_server_url` (§3).

Anthropic's credential proxy injects the token by matching these two. If they
drift, injection silently misses and the MCP connection falls back to
unauthenticated — which fails against a server that requires a Bearer token. The
URL lives only in your agent/vault config, never in the webhook payload.

---

## References

- ClickStack MCP server: [`MCP.md`](../MCP.md)
- [Managed Agents quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart)
- [Define your agent](https://platform.claude.com/docs/en/managed-agents/agent-setup)
- [Authenticate with vaults](https://platform.claude.com/docs/en/managed-agents/vaults)
- [MCP connector](https://platform.claude.com/docs/en/managed-agents/mcp-connector)
- [Start a session](https://platform.claude.com/docs/en/managed-agents/sessions)
- [Subscribe to webhooks](https://platform.claude.com/docs/en/managed-agents/webhooks)
- [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies)
