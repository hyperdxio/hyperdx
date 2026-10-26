---
'@hyperdx/app': patch
---

Choosing an operator in Explore's add-filter popover no longer discards the
filter you were building. The operator list was the only one of the three
rendered into a portal, which puts it outside the popover in the DOM, so
clicking an option registered as a click outside and closed the form — losing
the field you had already picked. The field and value lists were already
exempt.
