---
'@hyperdx/app': patch
---

fix: nest saved searches under Search and drop the extra sidebar item

Saved search favorites now expand under Search, matching dashboards. The
top-level Saved Searches nav item and separate catalog page are gone. A "Saved
searches" button in the search toolbar opens a drawer for browsing, favorites,
tag filtering, renaming, duplicating, and deletion. The button takes the name of
the selected saved search, and a badge beside it shows whether the search is
unsaved, saved, or edited since it was saved. Existing `/search/list` links open
that drawer.
