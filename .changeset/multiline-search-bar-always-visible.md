---
'@hyperdx/app': patch
---

fix: keep a multi-line search query visible when the search bar is not focused

The search bar collapsed to a single line whenever it lost focus, so everything past the first line of a multi-line query was hidden until you clicked back into it — you could not read the query you were looking at. Focusing it then expanded the bar into a floating overlay that covered the results underneath. It now sizes to its content and stays that way, growing the row instead of overlaying it, up to four lines in Lucene and 150px in SQL before it scrolls. The language switch beside it stretches to match and the `/` hint stays on the first line. Narrow fields that are not the query bar, such as SELECT and ORDER BY, still collapse on blur, since their values wrap and would otherwise permanently take the space.
