#!/bin/bash
set -e

# We don't have a JSON schema yet, so let's let the collector create the tables
if [ "$BETA_CH_OTEL_JSON_SCHEMA_ENABLED" = "true" ]; then
  exit 0
fi

DATABASE=${HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE:-default}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMAS_DIR="${SCRIPT_DIR}/schemas"

# Create database
clickhouse client -n <<EOFSQL
CREATE DATABASE IF NOT EXISTS ${DATABASE};
EOFSQL

# Execute schema files with variable substitution
export DATABASE
for schema_file in "${SCHEMAS_DIR}"/*.sql; do
  if [ -f "$schema_file" ]; then
    echo "Applying schema: $(basename "$schema_file")"
    envsubst < "$schema_file" | clickhouse client -n
  fi
done
