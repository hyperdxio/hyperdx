---
'@hyperdx/common-utils': patch
---

fix: Encode every `http://`, `https://` and `localhost:<port>` in a search, not
just the first

A search naming two or more URLs left the later colons unescaped, so Lucene read
them as field queries. `http://a.com http://b.com` compiled the second URL to
`http ILIKE '%//b.com%'` — a predicate on a bare `http` identifier rather than a
search of the log body.
