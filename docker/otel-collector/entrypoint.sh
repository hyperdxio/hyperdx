#!/bin/sh
set -e

# Run ClickHouse schema migrations if not using legacy schema creation
if [ "$HYPERDX_OTEL_EXPORTER_CREATE_LEGACY_SCHEMA" != "true" ]; then
  echo "========================================"
  echo "Running ClickHouse schema migrations..."
  echo "========================================"

  # Set connection defaults
  DB_NAME="${HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE:-default}"
  DB_USER="${CLICKHOUSE_USER:-default}"
  DB_PASSWORD="${CLICKHOUSE_PASSWORD:-}"
  echo "Target database: $DB_NAME"

  # Build goose connection string from environment variables
  # CLICKHOUSE_ENDPOINT format: tcp://host:port or clickhouse://host:port
  # Note: database is not specified here since SQL files use ${DATABASE} prefix explicitly
  case "$CLICKHOUSE_ENDPOINT" in
    *\?*) GOOSE_DBSTRING="${CLICKHOUSE_ENDPOINT}&username=${DB_USER}&password=${DB_PASSWORD}" ;;
    *)    GOOSE_DBSTRING="${CLICKHOUSE_ENDPOINT}?username=${DB_USER}&password=${DB_PASSWORD}" ;;
  esac

  # Create temporary directory for processed SQL files
  TEMP_SCHEMA_DIR="/tmp/schema"
  mkdir -p "$TEMP_SCHEMA_DIR"

  # Copy and process SQL files, replacing ${DATABASE} macro with actual database name
  echo "Preparing SQL files with database: $DB_NAME"
  cp -r /etc/otel/schema/* "$TEMP_SCHEMA_DIR/"
  find "$TEMP_SCHEMA_DIR" -name "*.sql" -exec sed -i "s/\${DATABASE}/${DB_NAME}/g" {} \;

  # Track migration status
  MIGRATION_ERRORS=0

  # Run migrations for each telemetry type
  for schema_dir in "$TEMP_SCHEMA_DIR"/*/; do
    if [ -d "$schema_dir" ]; then
      telemetry_type=$(basename "$schema_dir")
      echo "----------------------------------------"
      echo "Migrating $telemetry_type schemas..."
      echo "Directory: $schema_dir"

      # List SQL files to be executed
      for sql_file in "$schema_dir"/*.sql; do
        if [ -f "$sql_file" ]; then
          echo "  - $(basename "$sql_file")"
        fi
      done

      # Run goose migration with exponential backoff retry for connection issues
      MAX_RETRIES=5
      RETRY_COUNT=0
      RETRY_DELAY=1
      MIGRATION_SUCCESS=false

      # For _init schema, use 'default' database for version table since target DB doesn't exist yet
      if [ "$telemetry_type" = "_init" ]; then
        GOOSE_TABLE="default.clickstack_db_version_${telemetry_type}"
      else
        GOOSE_TABLE="${DB_NAME}.clickstack_db_version_${telemetry_type}"
      fi

      while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if goose -table "$GOOSE_TABLE" -dir "$schema_dir" clickhouse "$GOOSE_DBSTRING" up; then
          echo "SUCCESS: $telemetry_type migrations completed"
          MIGRATION_SUCCESS=true
          break
        else
          RETRY_COUNT=$((RETRY_COUNT + 1))
          if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            echo "RETRY: $telemetry_type migration failed, retrying in ${RETRY_DELAY}s... (attempt $RETRY_COUNT/$MAX_RETRIES)"
            sleep $RETRY_DELAY
            RETRY_DELAY=$((RETRY_DELAY * 2))
          fi
        fi
      done

      if [ "$MIGRATION_SUCCESS" = false ]; then
        echo "ERROR: $telemetry_type migrations failed after $MAX_RETRIES attempts"
        MIGRATION_ERRORS=$((MIGRATION_ERRORS + 1))
      fi
    fi
  done

  # Cleanup temporary directory
  rm -rf "$TEMP_SCHEMA_DIR"

  echo "========================================"
  if [ $MIGRATION_ERRORS -gt 0 ]; then
    echo "Schema migrations failed with $MIGRATION_ERRORS error(s)"
    exit 1
  else
    echo "Schema migrations completed successfully"
  fi
  echo "========================================"
fi

# Check if OPAMP_SERVER_URL is defined to determine mode
if [ -z "$OPAMP_SERVER_URL" ]; then
  # Standalone mode - run collector directly without supervisor
  echo "Running in standalone mode (OPAMP_SERVER_URL not set)"

  # Build collector arguments with multiple config files
  COLLECTOR_ARGS="--config /etc/otelcol-contrib/config.yaml --config /etc/otelcol-contrib/standalone-config.yaml"

  # Add custom config file if specified
  if [ -n "$CUSTOM_OTELCOL_CONFIG_FILE" ]; then
    echo "Including custom config: $CUSTOM_OTELCOL_CONFIG_FILE"
    COLLECTOR_ARGS="$COLLECTOR_ARGS --config $CUSTOM_OTELCOL_CONFIG_FILE"
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
