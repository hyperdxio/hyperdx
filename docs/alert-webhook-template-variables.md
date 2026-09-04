# Alert webhook template variables

**Generic** and **incident.io** webhook bodies are Handlebars templates. These
variables are available inside them, so a receiver can route, filter or dedupe
a HyperDX alert without parsing the human-readable message body.

| Variable | Type | Notes |
| --- | --- | --- |
| `{{title}}` | string | Alert title. |
| `{{body}}` | string | Rendered message body (markdown). |
| `{{link}}` | string | Deep link back into HyperDX. |
| `{{state}}` | string | Raw internal alert state. |
| `{{eventId}}` | string | Unique id for this firing. |
| `{{startTime}}` / `{{endTime}}` | number | Evaluation window, Unix ms. |
| `{{startTimeISO}}` / `{{endTimeISO}}` | string | The same window, ISO-8601. |
| `{{alertId}}` | string | Stable id of the alert itself — the key to dedupe on. |
| `{{status}}` | string | `firing`, `resolved`, `no_data`, `pending` or `error`. |
| `{{alertType}}` | string | `search`, `dashboard_chart` or `inline_query`. |
| `{{comparator}}` | string | `>=`, `>`, `<`, `<=`, `=`, `!=`, `between`, `outside`. |
| `{{threshold}}` | number | The configured threshold. |
| `{{thresholdMax}}` | number | Upper bound of a `between` / `outside` range; empty for every other comparator. |
| `{{value}}` | number | The value that triggered or resolved the alert. |
| `{{groupKey}}` | string | The breaching group, for a grouped alert. |
| `{{sourceQuery}}` | string | The query behind the alert: the saved search's filter, the chart's `where`, or the raw SQL. |
| `{{teamId}}` | string | Team the alert belongs to. |
| `{{note}}` | string | The alert's freeform note — commonly a runbook link. |

Strings are JSON-escaped, so they are safe to drop into a quoted slot.
Numbers (`startTime`, `endTime`, `threshold`, `thresholdMax`, `value`) are
emitted raw for unquoted slots. Every enriched variable is optional and renders
as an empty string when the alert doesn't carry it — an alert with no group has
an empty `{{groupKey}}`, and a non-range alert has an empty `{{thresholdMax}}`.

An empty variable in an unquoted numeric slot produces invalid JSON, so guard
the optional numbers: `{{#if thresholdMax}}"max": {{thresholdMax}},{{/if}}`.

## Example

Routing by severity and deduping on the alert rather than the firing:

```json
{
  "alert_id": "{{alertId}}",
  "dedup_key": "{{alertId}}-{{groupKey}}",
  "status": "{{status}}",
  "summary": "{{title}}",
  "urgency": "{{#if (eq alertType \"dashboard_chart\")}}low{{else}}high{{/if}}",
  "value": {{value}},
  "threshold": {{threshold}},
  "window": { "start": "{{startTimeISO}}", "end": "{{endTimeISO}}" },
  "runbook": "{{note}}",
  "link": "{{link}}"
}
```
