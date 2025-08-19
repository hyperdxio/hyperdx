#!/bin/sh
set -e

# Start log rotation script in background for agent.log
# Arguments: log_file_path [max_size_mb] [max_archives] [check_interval_seconds]
/log-rotator.sh /etc/otel/supervisor-data/agent.log 16 1 60 &

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
