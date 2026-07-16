---
'@hyperdx/app': minor
---

feat: Add a Share button that copies a shareable link to the clipboard on
search, Chart Explorer, dashboards, and the row/session side panels. Links whose
view state is large (e.g. Chart Explorer) are compressed into a single
`?share=` token using the browser-native `CompressionStream` (raw DEFLATE +
base64url) so they are far shorter than the raw query-param URL; small links
(e.g. a dashboard identified by its path) stay plain so they are never made
longer. Empty and duplicate query params are dropped from shared links.
