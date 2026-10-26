---
'@hyperdx/app': patch
---

Explore's filter bar is now SQL in every case. It offers no language switch,
but it read `whereLanguage` from the URL, so a saved search shared with the
Search page, an old link, or a side-panel action could put the bar into Lucene
— a mode with no way back out, since Explore has nothing to switch with.

Explore now coerces the language on the way in and rewrites the URL to match. A
Lucene clause that comes with it is dropped rather than run, because it cannot
be translated in the browser: `genWhereSQL` needs table metadata, so relabelling
the text as SQL would only fail in ClickHouse. Explore says when it discards
one, and the Search page still opens the search as saved.

Attribute chips in the event side panel now link with the SQL form of the
expression when the destination only takes SQL, instead of a Lucene condition
that would be thrown away on arrival.
