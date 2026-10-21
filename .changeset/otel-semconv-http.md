---
'@hyperdx/app': patch
---

fix: Read current OpenTelemetry HTTP and RPC semantic conventions (with deprecated names as fallbacks) in the span side panel and trace waterfall: redesign the HTTP panel around a request line and details, add a gRPC/RPC call panel, and flag correlated log errors and warnings by SeverityNumber or case-insensitive SeverityText
