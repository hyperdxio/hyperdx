#!/bin/sh
# Generic log tailer script that follows a log file and echoes new lines to stdout
# Handles file rotation and truncation (e.g., when used with log-rotator.sh)
# Usage: log-tailer.sh <log_file_path> [sleep_interval]

# Parse arguments
LOG_FILE="${1}"
SLEEP_INTERVAL="${2:-1}"

# Validate required argument
if [ -z "$LOG_FILE" ]; then
    echo "Error: Log file path is required" >&2
    echo "Usage: $0 <log_file_path> [sleep_interval]" >&2
    exit 1
fi

# Wait for file to exist if it doesn't yet
while [ ! -f "$LOG_FILE" ]; do
    echo "Waiting for log file to be created: $LOG_FILE" >&2
    sleep "$SLEEP_INTERVAL"
done

echo "Starting to tail: $LOG_FILE" >&2

# Use tail -F to follow the file by name, not by descriptor
# This handles rotation and truncation gracefully
# -n 0: Start from the end (don't output existing content)
# -F: Follow by name and retry if file is inaccessible
# -s: Sleep interval between checks
tail -n 0 -F -s "$SLEEP_INTERVAL" "$LOG_FILE"