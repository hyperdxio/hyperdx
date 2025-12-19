#!/bin/sh
set -e

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
