---
'@hyperdx/app': patch
---

Show every notification target an alert is configured with. The alerts page rows and the alert detail header only ever rendered the legacy singular `channel`, so an alert notifying three webhooks read as if it notified one, and the label was the generic "Webhook" rather than the webhook's name. Both surfaces now resolve all of an alert's channels: the detail page names each target with its service icon (Slack, incident.io, generic), keeping the first two inline and collapsing the rest into a `+N more` tooltip, while the alerts-page rows show the icons only with the names on hover, since spelling out up to ten names wrapped the row into an unreadable block. The hover-only names are also placed in the accessibility tree rather than left to an `aria-label` on a role-less wrapper.

The evaluation history's "Webhook Duration" column is renamed "Notification duration" and gains a tooltip. The value was always the wall time of the whole delivery, which fans out to every target concurrently, so a single slow webhook sets the figure — but the singular heading read as one webhook's latency. Per-target attribution is not available yet; nothing records it. The remaining column headings are corrected to sentence case.
