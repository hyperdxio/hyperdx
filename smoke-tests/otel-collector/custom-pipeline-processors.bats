#!/usr/bin/env bats

# HDX-4090: When a user supplies CUSTOM_OTELCOL_CONFIG_FILE that defines a
# new memory_limiter (with a name like memory_limiter/custom) and/or a new
# batch processor and swaps the pipeline `processors:` lists to reference
# them, the collector should:
#   1. Instantiate the user-defined processors at runtime.
#   2. Wire the custom processors into the pipelines (not the defaults).
#   3. Keep data flowing through the swapped pipelines (e.g., to the
#      ClickHouse exporter).
#
# These tests use the `otel-collector-custom` service in docker-compose.yaml,
# which loads `custom-pipeline-config.yaml` via CUSTOM_OTELCOL_CONFIG_FILE.

load 'test_helpers/utilities.bash'
load 'test_helpers/assertions.bash'

@test "HDX-4090: memory_limiter/custom is configured at runtime with percentage-derived limits" {
    # The memorylimiterprocessor logs a "Memory limiter configured" line at
    # startup with the resolved mib values. When configured via percentage,
    # the limit_mib is derived from host memory and will not equal the
    # default 1500 (which the bundled config.yaml sets).
    run docker compose logs otel-collector-custom

    # The default memory_limiter is still defined in the merged config but no
    # pipeline references it, so the collector skips its instantiation. Only
    # memory_limiter/custom should appear in the "Memory limiter configured"
    # log lines.
    [[ "$output" == *"Memory limiter configured"* ]]

    # The percentage-derived limit must not equal the default 1500 MiB. Any
    # host with >= ~2 GiB of memory will yield a different value at 75 %.
    [[ "$output" != *'"limit_mib":1500'* ]]
}

@test "HDX-4090: batch/lowlatency processor is exposed via prometheus metrics" {
    # The collector exports its own telemetry on the prometheus endpoint at
    # :8888 (mapped to 38888 on the host for this service). The batch
    # processor emits otelcol_processor_batch_* counters labelled with the
    # processor name, so the presence of label `processor="batch/lowlatency"`
    # in the metrics output is direct proof that the swap took effect.
    run curl --silent --show-error --max-time 5 http://localhost:38888/metrics
    [ "$status" -eq 0 ]

    # Custom batch processor metric labels should be present.
    [[ "$output" == *'processor="batch/lowlatency"'* ]]
}

@test "HDX-4090: data flows through the swapped logs/out-default pipeline to ClickHouse" {
    # Emit a log via OTLP HTTP. The swapped logs/out-default pipeline uses
    # memory_limiter/custom + transform + batch/lowlatency. If the swap had
    # broken the pipeline wiring the row would never reach ClickHouse.
    # The batch processor's timeout is 100 ms, so a brief sleep is enough.
    emit_otel_data "http://localhost:34318" "data/custom-pipeline/swap-data-flow"
    sleep 2
    assert_test_data "data/custom-pipeline/swap-data-flow"
}
