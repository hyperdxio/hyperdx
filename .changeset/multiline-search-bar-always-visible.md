---
'@hyperdx/app': patch
---

fix: keep a multi-line search query visible when the search bar is not focused

Multi-line SQL fields collapsed to a single line whenever they lost focus, so everything past the first line was hidden until you clicked back into them. Focusing one expanded it into a floating overlay that covered the content underneath. The search bar, SELECT, and ORDER BY now size to their content and stay that way, growing the layout instead of overlaying it, up to 150px before they scroll. Lucene search fields similarly grow up to four lines. Fields configured with `allowMultiline={false}` remain single-line in both SQL and Lucene. The language switch beside the search bar stretches to match.

A Lucene bar at the default size also no longer overhangs its own language switch. The Lucene input reserved a 38px row while drawing a 36px box inside it, so the switch beside it — sized to the 36px the SQL editor uses — stretched to the taller row and stood 2px proud of the input at either end. The two languages now take their height from one number per size, so the seam is flush in both and the bar does not change height when you switch between them. Only the default size was affected; the compact bar on the search and trace pages was already consistent at 30px.

The bar also drops its `WHERE` label. It repeated what the placeholder already says — "SQL WHERE clause (ex. column = 'foo')" — while taking horizontal room the query itself can use, which matters more now that a long query wraps rather than being cut off. Most places that embed this input already hid the label and labelled it themselves from the outside, so the option to show it is gone rather than merely defaulted off.

The `/` keycap that sat inside the bar is gone too. `/` and `s` still focus the input; only the overlay is removed so a long query is not clipped by a hint that is already documented in the keyboard shortcuts modal.
