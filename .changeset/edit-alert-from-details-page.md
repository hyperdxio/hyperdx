---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
'@hyperdx/api': patch
---

Allow editing and deleting alerts directly from the alert details page. An
"Edit alert" action opens a modal for changing the alert's threshold,
evaluation interval, schedule, group-by (saved-search alerts), notification
webhook, and note, and a Delete action (with confirmation) removes the alert
and returns to the alerts list. Alert API responses now include the
notification channel's webhook id and the alert's name/message template so
edits round-trip these fields.
