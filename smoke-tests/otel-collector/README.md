# OpenTelemetry Collector Smoke Tests

This directory contains smoke tests for validating the OpenTelemetry Collector
functionality in HyperDX.

## Prerequisites

Before running the tests, ensure you have the following tools installed:

- [Bats](https://github.com/bats-core/bats-core) - Bash Automated Testing System
- [Docker](https://www.docker.com/) and Docker Compose
- [curl](https://curl.se/) - Command line tool for transferring data
- [ClickHouse client](https://clickhouse.com/docs/en/integrations/sql-clients/clickhouse-client) -
  Command-line client for ClickHouse
  - Make sure to run `clickhouse install` to install the ClickHouse client after
    downloading ClickHouse

## Running the Tests

To run all the tests:

```bash
cd smoke-tests/otel-collector
bats *.bats
```

To run a specific test file:

```bash
bats hdx-1453-auto-parse-json.bats
```

## Test Structure

- `*.bats` - Test files written in Bats
- `setup_suite.bash` - Contains global setup_suite and teardown_suite functions
  that run once for the entire test suite
- `data/` - Test data used by the tests
- `test_helpers/` - Utility functions for the tests
- `docker-compose.yaml` - Docker Compose configuration for the test environment

### Signals covered

The suite exercises all three OTLP signal types against the standalone
collector config (`docker/otel-collector/config.standalone.yaml`):

- **logs** - severity inference/normalization, JSON auto-parse, JSON-schema
  exporter, compat-schema (old ClickHouse), custom-pipeline processor swap, and
  the `routing/logs` connector that splits rrweb (session replay) logs into
  `hyperdx_sessions` from ordinary logs in `otel_logs`.
- **traces** - the `traces` pipeline into `otel_traces` (`traces.bats`).
- **metrics** - the `metrics` pipeline into `otel_metrics_gauge`
  (`metrics.bats`).

### Test helpers

- `emit_otel_data <endpoint> <testdir> [signal]` - POSTs `<testdir>/input.json`
  to `/v1/<signal>`. `signal` is `logs` (default), `traces`, or `metrics`.
- `wait_for_rows <ch_port> <count_query> [max_attempts]` - polls a ClickHouse
  count query until it returns a non-zero result (or the attempt budget is
  exhausted). Prefer this over a fixed `sleep` after emitting data: it is both
  faster (returns as soon as rows land) and less flaky under load.

The test suite uses Bats' `setup_suite` and `teardown_suite` hooks to initialize
the environment only once, regardless of how many test files are run. This
optimizes test execution by:

1. Validating the environment once
2. Starting Docker containers once at the beginning of the test suite
3. Cleaning up containers once at the end of the test suite

## Debugging

If you need to debug the tests, you can set the `SKIP_CLEANUP` environment
variable to prevent the Docker containers from being torn down after the tests
complete:

```bash
SKIP_CLEANUP=1 bats *.bats
```

or

```bash
SKIP_CLEANUP=true bats *.bats
```

With `SKIP_CLEANUP` enabled, the test containers will remain running after the
tests complete, allowing you to inspect logs, connect to the containers, and
debug issues.

To manually clean up the containers after debugging:

```bash
docker compose down
```
