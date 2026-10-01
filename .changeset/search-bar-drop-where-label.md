---
'@hyperdx/app': patch
---

fix: drop the search bar WHERE label and `/` keycap overlay

The `WHERE` label repeated the SQL placeholder, and the `/` hint clipped long queries. `/` and `s` still focus the input; the overlay is gone.
