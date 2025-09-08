# Contributing

## Architecture Overview

![architecture](./.github/images/architecture.png)

Service Descriptions:

- OpenTelemetry Collector (otel-collector): Receives OpenTelemetry data from
  instrumented applications and forwards it to ClickHouse for storage. Includes
  OpAMP supervisor that dynamically pulls configuration from HyperDX API.
- ClickHouse (ch-server): ClickHouse database, stores all telemetry.
- MongoDB (db): Stores user/saved search/alert/dashboard data.
- HyperDX API (api): Node.js API, executes Clickhouse queries on behalf of the
  frontend and serves the frontend. serves the frontend. Can also run alert
  checker.
- HyperDX UI (app): Next.js frontend, serves the UI.

## Development

Pre-requisites:

- Docker
- Node.js (`>=18.12.0`)
- Yarn (v4)

You can get started by deploying a complete development stack in dev mode.

```bash
yarn run dev
```

This will start the Node.js API, Next.js frontend locally and the OpenTelemetry
collector and ClickHouse server in Docker.

To enable self-instrumentation and demo logs, you can set the `HYPERDX_API_KEY`
to your ingestion key (go to
[http://localhost:8080/team](http://localhost:8080/team) after creating your
account) and then restart the stack.

ex.

```sh
HYPERDX_API_KEY=<YOUR_INGESTION_API_KEY_HERE> yarn run dev
```

The core services are all hot-reloaded, so you can make changes to the code and
see them reflected in real-time.

### Volumes

The development stack mounts volumes locally for persisting storage under
`.volumes`. Clear this directory to reset ClickHouse and MongoDB storage.

### Windows

If you are running WSL 2, Hot module reload on Nextjs (Frontend) does not work
out of the box on windows when run natively on docker. The fix here is to open
project directory in WSL and run the above docker compose commands directly in
WSL. Note that the project directory should not be under /mnt/c/ directory. You
can clone the git repo in /home/{username} for example.

To develop from WSL, follow instructions
[here](https://code.visualstudio.com/docs/remote/wsl).

## Testing

### Integration Tests

To run the tests locally, you can run the following command:

```bash
make dev-int
```

If you want to run a specific test file, you can run the following command:

```bash
make dev-int FILE=checkAlerts
```

### Unit Tests

To run unit tests or update snapshots, you can go to the package you want (ex.
common-utils) to test and run:

```bash
yarn dev:unit
```

## Additional support

If you need help getting started,
[join our Discord](https://discord.gg/FErRRKU78j) and we're more than happy to
get you set up!
