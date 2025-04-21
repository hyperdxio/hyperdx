# OpenTelemetry Collector Smoke Tests

This directory contains smoke tests for validating the OpenTelemetry Collector functionality in HyperDX.

## Prerequisites

Before running the tests, ensure you have the following tools installed:

- [Bats](https://github.com/bats-core/bats-core) - Bash Automated Testing System
- [Docker](https://www.docker.com/) and Docker Compose
- [curl](https://curl.se/) - Command line tool for transferring data
- [ClickHouse client](https://clickhouse.com/docs/en/integrations/sql-clients/clickhouse-client) - Command-line client for ClickHouse

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
- `data/` - Test data used by the tests
- `test_helpers/` - Utility functions for the tests
- `docker-compose.yaml` - Docker Compose configuration for the test environment

## Debugging

If you need to debug the tests, you can set the `SKIP_CLEANUP` environment variable to prevent the Docker containers from being torn down after the tests complete:

```bash
SKIP_CLEANUP=1 bats hdx-1453-auto-parse-json.bats
```

or

```bash
SKIP_CLEANUP=true bats hdx-1453-auto-parse-json.bats
```

With `SKIP_CLEANUP` enabled, the test containers will remain running after the tests complete, allowing you to inspect logs, connect to the containers, and debug issues.

To manually clean up the containers after debugging:

```bash
docker compose down
```
