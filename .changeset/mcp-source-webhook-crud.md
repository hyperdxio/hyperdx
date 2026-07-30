---
'@hyperdx/api': minor
---

feat(mcp): add source and webhook management tools so the ingest → dashboard flow can be automated end to end. New MCP tools: `clickstack_save_source` / `clickstack_delete_source` and `clickstack_save_webhook` / `clickstack_delete_webhook` (save creates when `id` is omitted and updates when provided). Webhook logic is now shared via `createWebhook` / `updateWebhook` / `deleteWebhook` controllers: `createWebhook` is used by the internal API, External API v2, and MCP; `updateWebhook` / `deleteWebhook` are shared by External API v2 and MCP (the internal API retains its own masked-secret update/delete flow).

`clickstack_describe_source` now returns a round-trippable `config` block — the exact flat shape `clickstack_save_source` accepts, including fields the curated summary previously omitted (correlation IDs `logSourceId`/`traceSourceId`/`metricSourceId`/`sessionSourceId`, `defaultTableSelectExpression`, `parentSpanIdExpression`, `spanKindExpression`, materialized views, etc.). This closes the read/write asymmetry that made a faithful source clone impossible: an agent can read a source's full config back and pass it straight into `clickstack_save_source` to clone or read-modify-write it.

fix(alerts): a generic/incidentio webhook persisted without a body (the body default is only applied by the UI form, not the API/MCP create paths) no longer crashes `sendGenericWebhook` on `Handlebars.compile(undefined)`. It now falls back to the default body template so the alert still fires.
