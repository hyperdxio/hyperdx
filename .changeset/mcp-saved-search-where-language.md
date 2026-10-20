---
'@hyperdx/api': patch
---

fix(mcp): store whereLanguage as lucene when clickstack_save_saved_search creates a search without one, so its alerts no longer parse a Lucene filter as SQL
