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
    curl -s -X POST "$endpoint/v1/logs" \
        -H "Content-Type: application/json" \
        --data @"$datafile"

    # Check if the curl command succeeded
    if [ $? -ne 0 ]; then
        echo "❌ Error: Failed to send data to $endpoint" >&3
        return 1
    fi
    return 0
}

attempt_env_cleanup() {
    # Check if we should keep the test containers running
    if [[ "${SKIP_CLEANUP}" == "1" ]] || [[ "$(echo "${SKIP_CLEANUP}" | tr '[:upper:]' '[:lower:]')" == "true" ]]; then
        echo "🔍  SKIP_CLEANUP is set, skipping container cleanup" >&3
        return 0
    fi
    docker compose down
}
