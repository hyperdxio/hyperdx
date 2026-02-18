#!/bin/sh
set -e

# Fall back to legacy schema when the ClickHouse JSON feature gate is enabled
if echo "$OTEL_AGENT_FEATURE_GATE_ARG" | grep -q "clickhouse.json"; then
  export HYPERDX_OTEL_EXPORTER_CREATE_LEGACY_SCHEMA=true
fi

# Run ClickHouse schema migrations if not using legacy schema creation
if [ "$HYPERDX_OTEL_EXPORTER_CREATE_LEGACY_SCHEMA" != "true" ]; then
  # Run Go-based migrate tool with TLS support
  # TLS configuration:
  # - CLICKHOUSE_TLS_CA_FILE: CA certificate file
  # - CLICKHOUSE_TLS_CERT_FILE: Client certificate file
  # - CLICKHOUSE_TLS_KEY_FILE: Client private key file
  # - CLICKHOUSE_TLS_SERVER_NAME_OVERRIDE: Server name for TLS verification
  # - CLICKHOUSE_TLS_INSECURE_SKIP_VERIFY: Skip TLS verification (set to "true")
  echo "🚀 Using Go-based migrate tool with TLS support 🔐"
  migrate /etc/otel/schema/seed
fi

# Check if OPAMP_SERVER_URL is defined to determine mode
if [ -z "$OPAMP_SERVER_URL" ]; then
  # Standalone mode - run collector directly without supervisor
  echo "Running in standalone mode (OPAMP_SERVER_URL not set)"

  # Build collector arguments with multiple config files
  COLLECTOR_ARGS="--config /etc/otelcol-contrib/config.yaml --config /etc/otelcol-contrib/standalone-config.yaml"

  # Add bearer token auth config if OTLP_AUTH_TOKEN is specified (only used in standalone mode)
  if [ -n "$OTLP_AUTH_TOKEN" ]; then
    echo "OTLP_AUTH_TOKEN is configured, enabling bearer token authentication"
    COLLECTOR_ARGS="$COLLECTOR_ARGS --config /etc/otelcol-contrib/standalone-auth-config.yaml"
  fi

  # Add custom config file if specified
  if [ -n "$CUSTOM_OTELCOL_CONFIG_FILE" ]; then
    echo "Including custom config: $CUSTOM_OTELCOL_CONFIG_FILE"
    COLLECTOR_ARGS="$COLLECTOR_ARGS --config $CUSTOM_OTELCOL_CONFIG_FILE"
  fi

  # Pass feature gates to the collector in standalone mode
  if [ -n "$OTEL_AGENT_FEATURE_GATE_ARG" ]; then
    COLLECTOR_ARGS="$COLLECTOR_ARGS $OTEL_AGENT_FEATURE_GATE_ARG"
  fi

  # Execute collector directly
  exec /otelcontribcol $COLLECTOR_ARGS
else
  # Supervisor mode - run with OpAMP supervisor
  echo "Running in supervisor mode (OPAMP_SERVER_URL: $OPAMP_SERVER_URL)"

  if [ "$OTEL_SUPERVISOR_LOGS" = "true" ]; then
   # Start log tailer process in background for agent.log
    # Arguments: log_file_path [check_interval_seconds]
    /log-tailer.sh /etc/otel/supervisor-data/agent.log 1 &

    # Create a agent log file for the supervisor and collector child process. Normally
    # this file would be created as a standard file but we just want a FIFO pipe that
    # will pass data over to the tail process in the entrypoint script. This avoids
    # the need to the supervisor to store and forward the logs in its memory while also
    # eliminating the need for volume based storage.
    if [ ! -e /etc/otel/supervisor-data/agent.log ]; then
      mkfifo /etc/otel/supervisor-data/agent.log || echo "Failed to create FIFO" >&2
    fi
  fi

  # Render the supervisor config template using gomplate
  # Write to supervisor-data directory which has proper permissions for otel user
  gomplate -f /etc/otel/supervisor.yaml.tmpl -o /etc/otel/supervisor-data/supervisor-runtime.yaml

  # Log the configuration being used
  if [ -n "$CUSTOM_OTELCOL_CONFIG_FILE" ]; then
      echo "Using custom OTEL config file: $CUSTOM_OTELCOL_CONFIG_FILE"
  else
      echo "CUSTOM_OTELCOL_CONFIG_FILE not set, using default configuration"
  fi

  # Update the command arguments to use the rendered config file
  set -- "$1" --config /etc/otel/supervisor-data/supervisor-runtime.yaml

  # Execute the supervisor with all passed arguments
  exec "$@"
fi
