---
"@hyperdx/app": patch
---

Fix "Save Alert" doing nothing when editing an existing saved-search alert. The
alert form schema now accepts the persisted `numConsecutiveWindows: null` value
(so form validation no longer silently blocks submission), and the update
request resolves the alert id from the selected tab instead of an unregistered
form field.
