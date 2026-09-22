---
'@hyperdx/app': patch
---

feat: make multiline query fields collapsible

SQL and Lucene query fields that allow multiple lines stay at one line when
idle. Focusing them opens an overlay with the full value so the layout does
not reflow; blurring collapses them again. A pin control keeps the overlay
open after blur.
