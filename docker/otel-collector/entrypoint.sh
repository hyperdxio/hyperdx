#!/bin/sh
set -e

# Start log rotation script in background for agent.log
# Arguments: log_file_path [max_size_mb] [max_archives] [check_interval_seconds]
/log-rotator.sh /etc/otel/supervisor-data/agent.log 16 1 60 &

# Execute the supervisor with all passed arguments
exec "$@"
