---
'@hyperdx/app': patch
---

fix: nest saved searches under Search and drop the extra sidebar item

Saved search favorites now expand under Search, matching dashboards. The
top-level Saved Searches nav item and separate catalog page are gone. A "Saved
searches" button in the search toolbar opens a drawer for browsing, favorites,
tag filtering, renaming, duplicating, and deletion, next to a badge naming the
search on screen. Existing `/search/list` links open that drawer.
