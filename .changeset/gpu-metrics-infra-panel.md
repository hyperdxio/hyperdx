---
'@hyperdx/app': minor
---

Show GPU utilization and GPU memory utilization charts in the log/span side
panel Infrastructure section when `hw.gpu.*` metrics (OTel hardware semconv)
exist for the correlated host/node. Multiple GPUs on a host render as separate
series grouped by `hw.id`, and utilization is split per GPU engine by
`hw.gpu.task` (general/encoder/decoder) so a node saturated on video encode is
still visible; a missing task is reported as `general`. The section is fully
hidden when no GPU metrics are present and partially rendered when only one
metric is available.

The Infrastructure tab now also treats a Kubernetes resource attribute that is
present but empty (for example `k8s.node.name: ""`) as absent. Such rows
previously surfaced an Infrastructure tab that could render nothing.
