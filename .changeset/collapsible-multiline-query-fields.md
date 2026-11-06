---
'@hyperdx/app': patch
---

feat: make multiline query fields collapsible

SQL and Lucene query fields that allow multiple lines stay at one line when
idle. Focusing one shows the full value over the content below so the layout
does not reflow; blurring collapses it again. An expand control opens the
field for good, growing the row and pushing the content down.
