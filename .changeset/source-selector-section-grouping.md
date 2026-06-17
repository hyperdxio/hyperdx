---
'@hyperdx/app': patch
---

Group the data source selector by section and add tag-style search. When sources have a Section assigned, the selector lists them under section headers; search matches on both the source name and its section, so a section name acts as a tag (typing "billing" returns every source in the Billing section, including ones whose name does not contain "billing"). The selector stays flat until at least one source has a section, so deployments that have not adopted sections see no change.
