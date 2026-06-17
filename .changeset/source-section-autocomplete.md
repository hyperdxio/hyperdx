---
'@hyperdx/app': patch
---

Suggest existing section names in the source form's **Section** field. The field is now an autocomplete fed by the sections already in use, so a new source can reuse an existing section instead of retyping it (which is how a section ends up split into near-duplicates like "Billing" and "billing"). The field stays free-text, so any new section name is still accepted.
