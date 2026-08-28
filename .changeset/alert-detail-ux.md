---
'@hyperdx/app': minor
---

feat(alerts): tidy the alert detail header and its properties block

Edit, Delete and Terraform export move behind the same overflow menu the
alerts list uses, so the header no longer spreads four buttons across the top
and both surfaces offer the same actions. The link to what the alert watches
becomes an icon beside the alert name, where it reads as part of the alert's
identity rather than another action.

The properties block splits configuration from provenance: the creator now
sits with the created and updated timestamps in a dimmed line beneath, instead
of competing with the alert's settings.
