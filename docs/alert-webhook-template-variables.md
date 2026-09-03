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
| `{{threshold}}` | number | The configured threshold. For `between`/`outside`, the lower bound. |
| `{{thresholdMax}}` | number | Upper bound of a `between`/`outside` condition. Always unset for every other comparator, even if the alert was once a range, so guard it (see below). |
| `{{value}}` | number | The value that triggered or resolved the alert. |
| `{{groupKey}}` | string | The breaching group, for a grouped alert. |
| `{{sourceQuery}}` | string | The query behind the alert — search expression, SQL or PromQL (see below). |
| `{{teamId}}` | string | Team the alert belongs to. |
| `{{note}}` | string | The alert's freeform note — commonly a runbook link. |

Strings are JSON-escaped, so they are safe to drop into a quoted slot.
Numbers (`startTime`, `endTime`, `threshold`, `thresholdMax`, `value`) are
emitted raw for unquoted slots. Every enriched variable is optional and renders
as an empty string when the alert doesn't carry it — an alert with no group has
an empty `{{groupKey}}`, for instance.

`{{sourceQuery}}` reads whichever field the alert's query lives in: a
saved-search alert reports the search's `where` expression, a dashboard-tile
alert its tile's, and an inline alert its own. That is a Lucene or SQL search
expression for a builder chart, the SQL template for a raw SQL chart, and the
PromQL expression for a PromQL chart. Nothing in the variable set says which of
those you got, so treat it as opaque text rather than something to parse.

An empty string is not valid JSON in an unquoted numeric slot, so guard any
number that may be absent. Compare against `undefined` rather than using
`{{#if}}`, which treats a legitimate bound of `0` as absent:

```
{
  "threshold": {{threshold}}{{#unless (eq thresholdMax undefined)}},
  "threshold_max": {{thresholdMax}}{{/unless}}
}
```

Keep a newline or space between `{{/unless}}` and a closing `}` — Handlebars
reads `}}}` as a triple-stache and fails to compile the template.

The **Send test** button on the webhook form fills these variables with sample
values, so a template that uses them can be checked before an alert fires. The
sample is a `>=` alert, so `{{thresholdMax}}` is absent there.

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
