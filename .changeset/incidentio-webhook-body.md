---
'@hyperdx/api': patch
'@hyperdx/app': patch
'@hyperdx/common-utils': patch
---

fix: give incident.io webhooks a body incident.io accepts

An incident.io webhook saved without a body was sent the generic `{"text": ...}` payload, which has neither of the two fields incident.io requires, so every delivery was rejected and no alert was ever raised. It now gets an incident.io payload carrying a deduplication key that is stable across a firing and its resolve, so incident.io closes the alert it opened, plus the alert id, status, condition and evaluation window in `metadata` for routing. The webhook body editor and its list of template variables are also available when incident.io is the selected service, not only for Generic, so the payload can be tailored to an alert source's configured fields.
