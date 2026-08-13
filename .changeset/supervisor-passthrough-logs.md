---
'@hyperdx/otel-collector': patch
---

Use the OpAMP supervisor's native `passthrough_logs` for collector log
forwarding instead of a background `tail` process. The old approach had
the supervisor and the tailer writing to the same stdout fd with no
synchronization, so log lines were getting mangled by the two streams
interleaving mid-line. The native approach has the supervisor re-emitting
the collector's output through its own logger to avoid this.
