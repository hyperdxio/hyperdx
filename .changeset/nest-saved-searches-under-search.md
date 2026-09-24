---
'@hyperdx/app': patch
---

fix: nest saved searches under Search and drop the extra sidebar item

Saved search favorites now expand under Search, matching dashboards. The
top-level Saved Searches nav item and separate catalog page are gone: a compact,
searchable drawer on the Search page handles browsing, favorites, tag filtering,
renaming, duplicating, and deletion. Existing `/search/list` links open that
drawer.
