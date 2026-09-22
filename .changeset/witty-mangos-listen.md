---
'@hyperdx/app': minor
---

Add a Preferences → Search results → Row click setting. Leave it at `Open side
panel` (the default) for the existing behavior, or set it to `Expand inline` to
have a row click expand the row in place — the chevron's 16px hit target is hard
to aim at while scanning logs. With inline expansion on, the side panel moves to
a hover button on the row, stays one click away from an expanded row, and keeps
receiving row clicks while it is open.
