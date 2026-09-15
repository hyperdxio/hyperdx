---
'@hyperdx/app': patch
---

fix: keep a multi-line search query visible when the search bar is not focused

The search bar collapsed to a single line whenever it lost focus, so everything past the first line of a multi-line query was hidden until you clicked back into it — you could not read the query you were looking at. Focusing it then expanded the bar into a floating overlay that covered the results underneath. It now sizes to its content and stays that way, growing the row instead of overlaying it, up to four lines in Lucene and 150px in SQL before it scrolls. The language switch beside it stretches to match. Narrow fields that are not the query bar, such as SELECT and ORDER BY, still collapse on blur, since their values wrap and would otherwise permanently take the space.

A Lucene bar at the default size also no longer overhangs its own language switch. The Lucene input reserved a 38px row while drawing a 36px box inside it, so the switch beside it — sized to the 36px the SQL editor uses — stretched to the taller row and stood 2px proud of the input at either end. The two languages now take their height from one number per size, so the seam is flush in both and the bar does not change height when you switch between them. Only the default size was affected; the compact bar on the search and trace pages was already consistent at 30px.

The bar also drops its `WHERE` label. It repeated what the placeholder already says — "SQL WHERE clause (ex. column = 'foo')" — while taking horizontal room the query itself can use, which matters more now that a long query wraps rather than being cut off. Most places that embed this input already hid the label and labelled it themselves from the outside, so the option to show it is gone rather than merely defaulted off.

The `/` keycap that sat inside the bar is gone too. `/` and `s` still focus the input; only the overlay is removed so a long query is not clipped by a hint that is already documented in the keyboard shortcuts modal.
