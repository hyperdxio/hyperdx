---
'@hyperdx/app': minor
'@hyperdx/api': minor
---

feat(dashboards): list views sidebar with tag-only rules on the Dashboards listing page

Save reusable filter combinations as named "views" pinned to a
left-rail sidebar on the Dashboards listing page. Rules in v1 are
tag-only (`tag includes X`, `tag excludes Y`, `is untagged`) with an
`all` / `any` combinator. Clicking a view applies its rules to the
listing and shares the URL via `?view=<id>`; clicking it again clears
the active view. Edit and delete actions live on a kebab menu per
sidebar entry.

Backed by a new `/list-views` CRUD endpoint scoped per user and per
resource. The resource discriminator (`dashboard` | `savedSearch`)
is in the schema so Saved Searches parity drops in without a schema
change.
