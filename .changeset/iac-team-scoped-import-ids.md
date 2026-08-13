---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
---

Terraform export now emits team-scoped import ids (`<team_id>/<resource_id>`),
so resources can be imported from a ClickStack deployment that backs more than
one team. Each imported resource gains a `team` attribute, which the provider
marks as forcing replacement — the generated file now says to keep it. The
provider floor moves to `>= 3.25.0`, which drops server-only dashboard ids when
importing, so the generated dashboard config no longer churns tile ids (and the
tile alerts attached to them) on apply.
