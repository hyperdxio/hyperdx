---
'@hyperdx/app': patch
---

Color service map nodes by absolute error-rate thresholds instead of scaling
against the worst service on the graph. A service with no errors now renders
neutral grey rather than a pale red, and the remaining nodes fall into three
fixed buckets (under 1%, 1-5%, and 5% or above). A service the map has no error
data for — one that only calls others, with no incoming requests in the window —
renders hollow rather than filled, so "nothing measured" no longer looks like
"nothing wrong".

Previously every node was a shade of red whose intensity was normalized against
the graph-wide maximum, so a map whose worst service sat at 0.3% errors painted
it the same deep red as one at 60%, and a healthy service was indistinguishable
from one with a trace of errors. The legend for error rate now shows the four
discrete steps, marks the 1% and 5% boundaries, and adds a key for the hollow
state. Latency and throughput coloring is unchanged.
