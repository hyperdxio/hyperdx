---
'@hyperdx/app': patch
---

Saving a search no longer reloads the page: the new saved search is opened with
a client-side navigation, which also fixes the 404 this caused on the static
ClickStack build.
