---
'@hyperdx/app': patch
---

Color service map nodes by absolute error-rate thresholds instead of scaling
against the worst service on the graph. A service with no errors now renders
neutral grey rather than a pale red, and the remaining nodes fall into three
fixed buckets (under 1%, 1-5%, and 5% or above).

Previously every node was a shade of red whose intensity was normalized against
the graph-wide maximum, so a map whose worst service sat at 0.3% errors painted
it the same deep red as one at 60%, and a healthy service was indistinguishable
from one with a trace of errors. The legend for error rate now shows the four
discrete steps and labels the top of the scale with the threshold rather than
the observed maximum. Latency and throughput coloring is unchanged.
