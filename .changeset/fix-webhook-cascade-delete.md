---
"@hyperdx/api": patch
---

Fix: Block webhook deletion when one or more alerts still reference it, prompting the user to reassign or remove those alerts first.
