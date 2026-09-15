---
'@hyperdx/app': minor
---

feat: manage AI agents and wire them to alerts

Team settings → Integrations gains an AI agents section: provision an agent against your Anthropic account, or import one you wrote yourself by its ID, with the setup commands behind a disclosure for anyone who wants to write their own system prompt. Each agent takes a type — general, database, Kubernetes, application errors or latency — whose brief is appended to the standing SRE prompt, so a specialist can run alongside a general responder. The list names whose ClickStack access key each agent carries, because that is the identity it investigates as.

The alert notification picker becomes one searchable list of webhooks and agents rather than a webhook-only dropdown, so pairing an immediate page with an investigation is a second row instead of a choice between the two. Agent targets are named and iconed wherever webhooks already were, on the alerts list and the alert detail page. A target the picker cannot list — a deleted webhook, or an agent channel written through the API on a build with agents switched off — is shown as unavailable rather than rendering blank and being overwritten by the next selection.

Hidden unless `NEXT_PUBLIC_HDX_MANAGED_AGENTS_ENABLED` is set, with the create tab behind `NEXT_PUBLIC_HDX_MANAGED_AGENTS_ALLOW_CREATE`.
