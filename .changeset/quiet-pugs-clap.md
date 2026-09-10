---
'@hyperdx/app': patch
---

fix: keep the LLM dashboard scope filters clearable when their options fail to
load

The session and user dropdowns were disabled whenever their distinct-value query
was loading or had failed. With a filter applied that left the user looking at a
scope they could see but could not remove — permanently, if the query kept
failing. They now stay interactive whenever a value is applied.
