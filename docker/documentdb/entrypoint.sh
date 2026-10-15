#!/bin/bash
# Starts Postgres with the DocumentDB extensions, then the gateway on :10260.
# Run as root: fixes data dir ownership, then re-runs itself as postgres.
set -euo pipefail
: "${DOCDB_USER:?DOCDB_USER is required}" "${DOCDB_PASSWORD:?DOCDB_PASSWORD is required}"

if [ "$(id -u)" = 0 ]; then
  # Volumes may be root-owned or hold lost+found, and initdb needs an empty dir it owns.
  install -d -o postgres -g postgres -m 700 "$PGDATA"
  exec su-exec postgres "$0" "$@"
fi

# The marker is written last, so a first boot killed part-way is redone, not left broken.
if [ ! -f "$PGDATA/.documentdb-initialised" ]; then
  find "$PGDATA" -mindepth 1 -delete
  initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null
  cat >> "$PGDATA/postgresql.conf" <<CONF
listen_addresses = 'localhost'
unix_socket_directories = '/tmp'
shared_preload_libraries = 'pg_cron, pg_documentdb_core, pg_documentdb, pg_documentdb_extended_rum'
cron.database_name = 'postgres'
documentdb.enableBackgroundWorker = true
documentdb.enableBackgroundWorkerJobs = true
documentdb.indexBuildsScheduledOnBgWorker = false
documentdb.rum_library_load_option = 'require_documentdb_extended_rum'
documentdb.alternate_index_handler_name = 'extended_rum'
CONF
  pg_ctl -D "$PGDATA" -l "$PGDATA/postgresql.log" -w start >/dev/null
  psql -h /tmp -U postgres -d postgres -qX -v ON_ERROR_STOP=1 -c "CREATE EXTENSION documentdb CASCADE; CREATE EXTENSION documentdb_extended_rum;"
  doc=$(printf '{"createUser":"%s","pwd":"%s","roles":[{"role":"readWriteAnyDatabase","db":"admin"},{"role":"clusterAdmin","db":"admin"}]}' "$DOCDB_USER" "$DOCDB_PASSWORD")
  psql -h /tmp -U postgres -d postgres -qX -v ON_ERROR_STOP=1 -v doc="$doc" <<< "SELECT documentdb_api.create_user(:'doc');" >/dev/null
  touch "$PGDATA/.documentdb-initialised"
else
  pg_ctl -D "$PGDATA" -l "$PGDATA/postgresql.log" -w start >/dev/null
fi

echo "postgresql://postgres@localhost:5432/postgres" > /tmp/pg-url
mkdir -p /tmp/tls
export DOCUMENTDB_PG_URL_FILE=/tmp/pg-url DOCUMENTDB_TLS_STATE_DIR=/tmp/tls

documentdb-gateway run --config /etc/documentdb/gateway/SetupConfiguration.json &
gateway=$!
# Stop Postgres cleanly on docker stop so persistent volumes skip crash recovery.
trap 'kill "$gateway" 2>/dev/null; pg_ctl -D "$PGDATA" -m fast stop >/dev/null; exit 0' TERM INT
# Keep the gateway's exit code so a crash shows as a failed container, not a clean exit.
rc=0
wait "$gateway" || rc=$?
pg_ctl -D "$PGDATA" -m fast stop >/dev/null || true
exit "$rc"
