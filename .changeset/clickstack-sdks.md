---
'@hyperdx/api': minor
'@hyperdx/app': minor
---

feat: self-instrument with `@clickhouse/clickstack-node` and
`@clickhouse/clickstack-browser` instead of `@hyperdx/node-opentelemetry` and
`@hyperdx/browser`

HyperDX's own telemetry changes shape. HTTP spans use the stable semantic
convention keys (`http.request.method`, `http.response.status_code`,
`url.full`). pino records come from the `@opentelemetry/instrumentation-pino`
scope with real severity numbers instead of the `node-logger` scope with
severity number 0. Console capture covers every `console` call in the API, and
browser console output is recorded as log records instead of spans. Uncaught
exceptions are recorded as FATAL log records, and API errors as an exception
event on the Express span instead of a separate error span.

Browser telemetry records the user as `user.id`, `user.email` and `user.name`
instead of `userEmail` and `userName`, keeps the team name as `teamName`, and no
longer records a `user navigated` action. Browser fetch and XHR spans no longer
record request and response headers or bodies. Browser sessions restart once
after the upgrade. The per-signal browser endpoints and
`NEXT_PUBLIC_OTEL_RESOURCE_ATTRIBUTES` work as before.

The Next.js server now sends its own telemetry in production builds too, not
only under `next dev`, when `HYPERDX_API_KEY` or `OTEL_EXPORTER_OTLP_HEADERS` is
set. `HDX_EXPORTER_ENABLED=false` turns it off along with browser telemetry. It
reports under its own service name, the configured one plus `-next`
(`hdx-oss-app-next` in the docker-compose `app` service and when no name is
set), so its spans stay apart from the API's and the browser's. The HyperDX
images now default `OTEL_SERVICE_NAME` to `hdx-oss-app`. Each `/api` request
adds Next.js server spans for the proxy hop. Requests for build and `public/`
assets, such as `/_next/static/*`, `/__ENV.js` and `/pyodide/*`, are not traced.

`HYPERDX_API_KEY` still enables self-instrumentation. Without
`OTEL_EXPORTER_OTLP_ENDPOINT`, server-side self-telemetry now goes to
`http://localhost:4318` instead of `https://in-otel.hyperdx.io`, so set the
endpoint explicitly. `HDX_NODE_*` variables are no longer read. For request
headers and bodies set `OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_*` and
`CLICKSTACK_CAPTURE_HTTP_BODY`.
