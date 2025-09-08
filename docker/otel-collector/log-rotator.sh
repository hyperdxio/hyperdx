#!/bin/sh
# Generic log rotation script that rotates any log file when it exceeds a certain size
# Usage: log-rotator.sh <log_file_path> [max_size_mb] [max_archives] [check_interval_seconds]

# Parse arguments
LOG_FILE="${1}"
MAX_SIZE_MB="${2:-100}"
MAX_ARCHIVES="${3:-5}"
CHECK_INTERVAL="${4:-300}"

# Validate required argument
if [ -z "$LOG_FILE" ]; then
    echo "Error: Log file path is required"
    echo "Usage: $0 <log_file_path> [max_size_mb] [max_archives] [check_interval_seconds]"
    exit 1
fi

MAX_SIZE_BYTES=$((MAX_SIZE_MB * 1024 * 1024))

echo "Starting log rotation for: $LOG_FILE"
echo "Settings: Max size=${MAX_SIZE_MB}MB, Max archives=${MAX_ARCHIVES}, Check interval=${CHECK_INTERVAL}s"

while true; do
    sleep "$CHECK_INTERVAL"
    
    if [ -f "$LOG_FILE" ]; then
        SIZE=$(stat -c%s "$LOG_FILE" 2>/dev/null || stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)
        
        if [ "$SIZE" -gt "$MAX_SIZE_BYTES" ]; then
            echo "Rotating $LOG_FILE (size: $SIZE bytes)"
            
            # Rotate existing archives
            for i in $(seq $((MAX_ARCHIVES - 1)) -1 1); do
                if [ -f "${LOG_FILE}.${i}" ]; then
                    mv "${LOG_FILE}.${i}" "${LOG_FILE}.$((i + 1))"
                fi
            done
            
            # Move current log to .1
            cp "$LOG_FILE" "${LOG_FILE}.1"
            > "$LOG_FILE"  # Truncate the original file
            
            # Remove oldest archive if it exists
            if [ -f "${LOG_FILE}.${MAX_ARCHIVES}" ]; then
                rm "${LOG_FILE}.${MAX_ARCHIVES}"
            fi
        fi
    fi
done