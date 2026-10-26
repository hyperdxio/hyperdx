---
'@hyperdx/app': patch
---

Stop the Search page's Lucene/SQL choice from following you into Explore.
Adding a chart series on Explore seeded its condition from the cross-page
stored language preference, so switching the Search page to Lucene silently
changed what a new Explore series expected you to type. Explore now starts
every series, and every unset condition, in SQL. Series that explicitly
carry Lucene in a saved search or a shared link still render as Lucene.
