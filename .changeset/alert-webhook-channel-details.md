---
'@hyperdx/app': patch
---

Show each webhook's description (or its masked URL) when picking a notification
destination for an alert (issue #1780). The webhook select on the saved-search
and chart alert forms now renders the detail under each option and under the
chosen webhook, so you can tell where an alert will post instead of picking from
a list of names alone.
