---
'@hyperdx/app': patch
---

fix: nest saved searches under Search and drop the extra sidebar item

Saved search favorites now expand under Search, matching dashboards. The
top-level Saved Searches nav item and separate catalog page are gone. The search
title is now a switcher: it opens a searchable list of saved searches, and
"Manage saved searches" opens a drawer for browsing, favorites, tag filtering,
renaming, duplicating, and deletion. Existing `/search/list` links open that
drawer.
