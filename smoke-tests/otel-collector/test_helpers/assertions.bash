assert_test_data() {
    local testdir=$1
    local query_file="${testdir}/assert_query.sql"
    local expected_file="${testdir}/expected.snap"

    # Check if the query file exists and is readable
    if [ ! -f "$query_file" ]; then
        echo "❌ Error: Query file '$query_file' does not exist." >&3
        return 1
    fi

    if [ ! -r "$query_file" ]; then
        echo "❌ Error: Query file '$query_file' is not readable." >&3
        return 1
    fi

    # Check if the expected file exists and is readable
    if [ ! -f "$expected_file" ]; then
        echo "❌ Error: Expected file '$expected_file' does not exist." >&3
        return 1
    fi

    if [ ! -r "$expected_file" ]; then
        echo "❌ Error: Expected file '$expected_file' is not readable." >&3
        return 1
    fi

    # Execute the query using clickhouse-client and capture the results
    local query_result=$(clickhouse-client --queries-file="$query_file" 2>&1)

    # Check if the clickhouse-client command succeeded
    if [ $? -ne 0 ]; then
        echo "❌ Error: Failed to execute query: $query_result" >&3
        return 1
    fi

    # Read the expected results from the expected file
    local expected_result=$(cat "$expected_file")

    # Compare the query result with the expected result
    if [ "$query_result" = "$expected_result" ]; then
        return 0
    else
        echo "❌ Test failed: Query results do not match expected output" >&3
        echo "  Expected: $expected_result" >&3
        echo "  Actual: $query_result" >&3
        return 1
    fi
}




