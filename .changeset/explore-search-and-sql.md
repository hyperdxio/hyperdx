---
'@hyperdx/app': patch
---

Let search and raw SQL work together on the Explore page instead of forcing a
choice between them. The `Search | Raw SQL` toggle is replaced by a `SQL`
button that folds a full statement editor out beneath the search box, closed by
default. While the query is generated it tracks the search above; your first
keystroke hands it over, the button marks it as edited, and "Reset to generated"
hands it back. The search box and filter pills keep applying either way — they
now compile into `$__filters`, and the panel warns if an edit drops that macro.

Switching to SQL no longer discards your search, so the confirmation dialog that
used to copy the query to the clipboard before wiping it is gone.
