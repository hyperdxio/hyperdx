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
| `{{sourceQuery}}` | string | The condition behind the alert — search expression or SQL (see below). |
| `{{teamId}}` | string | Team the alert belongs to. |
| `{{note}}` | string | The alert's freeform note — commonly a runbook link. |

Strings are JSON-escaped, so they are safe to drop into a quoted slot.
Numbers (`startTime`, `endTime`, `threshold`, `thresholdMax`, `value`) are
emitted raw for unquoted slots. Every enriched variable is optional and renders
as an empty string when the alert doesn't carry it — an alert with no group has
an empty `{{groupKey}}`, for instance.

`{{sourceQuery}}` reads whichever fields the alert's condition lives in: a
saved-search alert reports the search's, a dashboard-tile alert its tile's, and
an inline alert its own. For a raw SQL chart that is the whole SQL template.
Otherwise the condition is spread over several inputs and they are joined with
`AND`, each bracketed when there is more than one — for example
`(ServiceName: "checkout") AND (SeverityText: "error")`. An alert with no
condition at all reports an empty string.

It reports only what the alert query actually applies, so it will not always
match everything the chart shows. A builder chart contributes its chart-level
`where` and the `aggCondition` of the series the alert reads — the last one,
which is the series that produces the value. A chart's pinned `filters` and
`having` are **not** included, because a tile or inline alert does not apply
them. A saved search contributes its `where` and its pinned `filters`, which it
does apply.

Treat the result as opaque text rather than something to parse or re-run:
nothing in the variable set says which dialect you got, and the parts of a
builder condition can each be Lucene or SQL, so the joined string is not
necessarily valid in either. It is truncated at 2000 characters. PromQL charts
do not support alerts, so no webhook carries a PromQL expression.

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

The **Send test** button on the webhook form fills every variable with a sample
value, so a template that uses them can be checked before an alert fires. The
sample is a `between` alert, so `{{thresholdMax}}` is populated there — a test
send will not catch a template that breaks when an optional number is absent,
which is what the guard above is for.

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
