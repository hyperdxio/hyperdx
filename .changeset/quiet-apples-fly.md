---
"@hyperdx/app": patch
---

fix: Fix histogram disappearing and scrollbar issues on event patterns and search pages

Fixes regression from PR #1598 by adding proper flex container constraints to prevent histogram from disappearing and scrollbar from cutting off 120px early.
