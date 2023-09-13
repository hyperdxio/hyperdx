# Contributing

## Architecture Overview

![architecture](./.github/images/architecture.png)

Service Descriptions:

- otel: OpenTelemetry Collector, allows us to receive OpenTelemetry data from
  instrumented applications and forward it to the ingestor for futher
  processing.
- ingestor: Vector-based event pipeline that receives Otel and non-Otel events
  and parses/normalizes/forwards it to the aggregator.
- aggregator: Node.js service that receives events from the ingestor, verifies
  authentication, and inserts it to Clickhouse for storage.
- clickhouse: Clickhouse database, stores all events.
- db: MongoDB, stores user/alert/dashboard data.
- api: Node.js API, executes Clickhouse queries on behalf of the frontend.
- app: Next.js frontend, serves the UI.
- task-check-alerts: Checks for alert criteria and fires off any alerts as
  needed.

## Development

You can get started by deploying a complete stack via Docker Compose. The core
services are all hot-reloaded, so you can make changes to the code and see them
reflected in real-time.

If you need help getting started,
[join our Discord](https://discord.gg/FErRRKU78j) and we're more than happy to
get you set up!
