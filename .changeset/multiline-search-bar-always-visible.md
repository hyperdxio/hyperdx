---
'@hyperdx/app': patch
---

fix: keep a multi-line search query visible when the search bar is not focused

Multi-line SQL fields collapsed to a single line whenever they lost focus, so everything past the first line was hidden until you clicked back into them. Focusing one expanded it into a floating overlay that covered the content underneath.

Staying expanded is opt-in via `keepMultilineVisible`. The search WHERE (when multiline is allowed), SELECT, and ORDER BY pass it, so they size to their content and grow the layout instead of overlaying it, up to 150px before they scroll. Other inline SQL editors still wrap on focus and collapse on blur, so dense source and chart forms do not permanently grow. Lucene search fields similarly grow up to four lines. Fields with `allowMultiline={false}` remain single-line in both SQL and Lucene.

The language switch beside the search bar stretches to match, with no divider between it and the input. A Lucene bar at the default size also no longer overhangs that switch. The Lucene input reserved a 38px row while drawing a 36px box inside it, so the switch — sized to the 36px the SQL editor uses — stood 2px proud of the input. Both languages now take their height from one shared table, so the seam is flush and the bar does not change height when you switch. Only the default size was affected; the compact bar was already consistent at 30px.

Toolbar controls beside a growing search bar stay aligned with its first line (date picker, live tail, Run, and the Kubernetes filter row). Focus now recolors the whole control, including the language switch, without overriding an error or warning border.

The bar also drops its `WHERE` label. It repeated what the placeholder already says — "SQL WHERE clause (ex. column = 'foo')" — while taking horizontal room the query itself can use, which matters more now that a long query wraps rather than being cut off. Most places that embed this input already hid the label and labelled it themselves from the outside, so the option to show it is gone rather than merely defaulted off.

The `/` keycap that sat inside the bar is gone too. `/` and `s` still focus the input; only the overlay is removed so a long query is not clipped by a hint that is already documented in the keyboard shortcuts modal.
