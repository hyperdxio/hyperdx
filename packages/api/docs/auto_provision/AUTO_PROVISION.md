# Auto-Provisioning Connections and Sources

HyperDX supports automatic provisioning of connections and sources for new
instances. This is useful for:

- Local development environments
- Automated deployments
- CI/CD pipelines
- Docker Compose environments

## How It Works

When a new team is created in HyperDX, it checks for the presence of the
following environment variables:

- `DEFAULT_CONNECTIONS`: A JSON array of connection configurations
- `DEFAULT_SOURCES`: A JSON array of source configurations

If these environment variables are set and the team has no existing connections
or sources, HyperDX will automatically create them for the new team.

## Usage

### Setting Default Connections

To set default connections, provide a JSON array of connection objects as the
`DEFAULT_CONNECTIONS` environment variable. Each connection object should
include:

- `name`: A descriptive name for the connection
- `host`: The hostname or IP address of the database server
- `username`: The username for authentication
- `password`: (Optional) The password for authentication

Example:

```json
[
  {
    "name": "Local ClickHouse",
    "host": "clickhouse:8123",
    "username": "default",
    "password": ""
  }
]
```

### Setting Default Sources

To set default sources, provide a JSON array of source objects as the
`DEFAULT_SOURCES` environment variable. Each source object should include:

- `name`: A descriptive name for the source
- `kind`: The type of source (`log`, `trace`, `session`, or `metric`)
- `connection`: The name of the connection to use (must match a connection name
  or ID)
- `from`: An object specifying the database and table names
  - `databaseName`: The name of the database
  - `tableName`: The name of the table
- Various expressions specific to the source type (see examples below)

Example for logs:

```json
[
  {
    "name": "HyperDX Logs",
    "kind": "log",
    "connection": "Local ClickHouse",
    "from": {
      "databaseName": "default",
      "tableName": "logs"
    },
    "timestampValueExpression": "timestamp",
    "displayedTimestampValueExpression": "timestamp",
    "bodyExpression": "body",
    "severityTextExpression": "severity_text",
    "serviceNameExpression": "service_name",
    "resourceAttributesExpression": "resource",
    "traceIdExpression": "trace_id",
    "spanIdExpression": "span_id"
  }
]
```

### Correlating Sources

HyperDX allows sources to be correlated with each other. This enables features
like navigating from a log to related traces, or from a trace to related logs.
To set up these correlations in your default sources, use the following fields:

- `logSourceId`: Reference to a log source by name
- `traceSourceId`: Reference to a trace source by name
- `sessionSourceId`: Reference to a session source by name
- `metricSourceId`: Reference to a metric source by name

Example with correlated sources:

```json
[
  {
    "name": "HyperDX Logs",
    "kind": "log",
    "connection": "Local ClickHouse",
    "from": {
      "databaseName": "default",
      "tableName": "logs"
    },
    "timestampValueExpression": "timestamp",
    "bodyExpression": "body",
    "traceIdExpression": "trace_id",
    "spanIdExpression": "span_id",
    "traceSourceId": "HyperDX Traces"
  },
  {
    "name": "HyperDX Traces",
    "kind": "trace",
    "connection": "Local ClickHouse",
    "from": {
      "databaseName": "default",
      "tableName": "traces"
    },
    "timestampValueExpression": "startTimeUnixNano / 1000000000",
    "durationExpression": "durationNano",
    "spanNameExpression": "name",
    "traceIdExpression": "traceId",
    "spanIdExpression": "spanId",
    "logSourceId": "HyperDX Logs"
  }
]
```

In this example:

- The log source "HyperDX Logs" references the trace source by name with
  `traceSourceId: "HyperDX Traces"`
- The trace source "HyperDX Traces" references the log source by name with
  `logSourceId: "HyperDX Logs"`

These references are resolved automatically during source creation, allowing
seamless navigation between correlated sources in the HyperDX UI.

## Docker Compose Example

Here's an example of how to set these variables in a Docker Compose file:

```yaml
version: '3'
services:
  hyperdx-api:
    image: docker.hyperdx.io/hyperdx/api:latest
    environment:
      - DEFAULT_CONNECTIONS=[{"name":"Local
        ClickHouse","host":"clickhouse:8123","username":"default","password":""}]
      - DEFAULT_SOURCES=[{"name":"HyperDX Logs","kind":"log","connection":"Local
        ClickHouse","from":{"databaseName":"default","tableName":"logs"},"timestampValueExpression":"timestamp","bodyExpression":"body","traceSourceId":"HyperDX
        Traces"},{"name":"HyperDX Traces","kind":"trace","connection":"Local
        ClickHouse","from":{"databaseName":"default","tableName":"traces"},"timestampValueExpression":"startTimeUnixNano
        / 1000000000","traceIdExpression":"traceId","logSourceId":"HyperDX
        Logs"}]
```

For more complex configurations, you can use environment files or Docker secrets
to manage these values.

## Note on Security

While this feature is convenient for development and initial setup, be careful
with including sensitive connection details like passwords in environment
variables for production deployments. Consider using Docker secrets or other
secure methods for managing sensitive configuration in production environments.
