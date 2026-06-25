validate_env() {
    # Check if docker is installed
    if ! command -v docker &> /dev/null; then
        echo "❌ Error: docker is not installed. Please install docker to continue." >&3
        return 1
    fi

    # Check if curl is installed
    if ! command -v curl &> /dev/null; then
        echo "❌ Error: curl is not installed. Please install curl to continue." >&3
        return 1
    fi

    # Check if clickhouse-client is installed
    if ! command -v clickhouse-client &> /dev/null; then
        echo "❌ Error: clickhouse-client is not installed. Please install clickhouse-client to continue. (Did you run `clickhouse install` yet?)" >&3
        return 1
    fi

    echo "🌳 environment validation passed" >&3
    return 0
}

wait_for_ready() {
    local container_name=$1
    local max_attempts=10
    local wait_time=0

    echo "🍿 waiting for container $container_name to be ready" >&3
    until [ $wait_time -eq $max_attempts ] || [[ $(docker compose logs "$container_name" | grep "Everything is ready") ]]
    do
        sleep $wait_time
        wait_time=$((wait_time + 1))
    done

    # Check if we reached max attempts (container not ready)
    if [ $wait_time -eq $max_attempts ]; then
        echo "❌ Error: Container $container_name not ready after $max_attempts attempts" >&3
        return 1
    fi

    echo "   └→ Container $container_name is ready" >&3
    return 0
}

emit_otel_data() {
    local endpoint=$1
    local testdir=$2
    # Optional third argument selects the OTLP signal: logs (default), traces,
    # or metrics. It maps to the matching /v1/<signal> ingest path.
    local signal=${3:-logs}
    local datafile="${testdir}/input.json"

    # Check if the data file exists and is readable
    if [ ! -f "$datafile" ]; then
        echo "❌ Error: Data file '$datafile' does not exist." >&3
        return 1
    fi

    if [ ! -r "$datafile" ]; then
        echo "❌ Error: Data file '$datafile' is not readable." >&3
        return 1
    fi

    # Send the JSON file as a single request
    curl -s -X POST "$endpoint/v1/${signal}" \
        -H "Content-Type: application/json" \
        --data @"$datafile"

    # Check if the curl command succeeded
    if [ $? -ne 0 ]; then
        echo "❌ Error: Failed to send data to $endpoint" >&3
        return 1
    fi
    return 0
}

# Poll a ClickHouse count query until at least `expected_count` rows are present
# or the attempt budget is exhausted. This replaces fixed `sleep` calls after
# emitting data: the collector's batch timeout is short (100ms in the smoke
# env), but the round trip through the exporter into ClickHouse is not
# instantaneous, and a fixed sleep is both slower (always waits the full
# duration) and flakier (may wait too little under load).
#
# IMPORTANT: pass the FULL number of rows the subsequent snapshot assertion
# expects, not 1. The collector's batch exporter may flush a multi-record
# payload across several micro-batches, so the first rows can land before the
# rest. Unblocking on the first row would let assert_test_data run against a
# partial result and fail intermittently. Waiting for the full count makes the
# assertion deterministic.
#
# Usage: wait_for_rows <clickhouse_port> <count_query> <expected_count> [max_attempts]
wait_for_rows() {
    local port=$1
    local count_query=$2
    local expected_count=$3
    local max_attempts=${4:-30}
    local attempt=0
    # Captures the most recent clickhouse-client stderr so it can be surfaced on
    # timeout instead of being silently swallowed (e.g. ClickHouse not yet
    # listening, or a typo in a column name that makes the query always error).
    local last_err=""
    local err_file
    err_file=$(mktemp "${TMPDIR:-/tmp}/wait_for_rows.XXXXXX")

    while [ "$attempt" -lt "$max_attempts" ]; do
        local count
        count=$(clickhouse-client --port="$port" --query="$count_query" 2>"$err_file")
        last_err=$(cat "$err_file")
        # The `2>/dev/null` guards the integer comparison against a non-numeric
        # `count` (e.g. empty stdout when the query errored), which would
        # otherwise emit a bash "integer expression expected" error.
        if [ -n "$count" ] && [ "$count" -ge "$expected_count" ] 2>/dev/null; then
            rm -f "$err_file"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 0.5
    done

    rm -f "$err_file"

    echo "❌ Error: expected >= $expected_count row(s) within $((max_attempts / 2))s for query: $count_query" >&3
    echo "   last observed count: '${count:-<empty>}'" >&3
    if [ -n "$last_err" ]; then
        echo "   last clickhouse-client error: $last_err" >&3
    fi
    return 1
}

attempt_env_cleanup() {
    # Check if we should keep the test containers running
    if [[ "${SKIP_CLEANUP}" == "1" ]] || [[ "$(echo "${SKIP_CLEANUP}" | tr '[:upper:]' '[:lower:]')" == "true" ]]; then
        echo "🔍  SKIP_CLEANUP is set, skipping container cleanup" >&3
        return 0
    fi
    docker compose down
}
