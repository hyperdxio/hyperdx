---
'@hyperdx/app': patch
---

fix: keep a multi-line query visible when the field is not focused

Multi-line SQL fields collapsed to a single line whenever they lost focus, so everything past the first line was hidden until you clicked back into them. Focusing one expanded it into a floating overlay that covered the content underneath — and in a container sized to its content, that overlay left the layout flow and shrank the field to a sliver one character wide.

Any field that allows multiple lines now simply sizes to its content, focused or not, growing the layout rather than floating over it, up to 150px before it scrolls. That covers the search WHERE, SELECT and ORDER BY, the chart editor's SQL fields, and PromQL. Lucene search fields similarly grow up to four lines. Fields with `allowMultiline={false}` remain single-line in both SQL and Lucene. The focus overlay is gone rather than made optional, so there is no longer a separate expand-on-focus state to reason about.

The language switch beside the search bar stretches to match, with no divider between it and the input. A Lucene bar at the default size also no longer overhangs that switch. The Lucene input reserved a 38px row while drawing a 36px box inside it, so the switch — sized to the 36px the SQL editor uses — stood 2px proud of the input. Both languages now take their height from one shared table, so the seam is flush and the bar does not change height when you switch. Only the default size was affected; the compact bar was already consistent at 30px.

Focus recolors the whole control, including the language switch, without overriding an error or warning border.
