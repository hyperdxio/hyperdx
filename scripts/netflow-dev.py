#!/usr/bin/env python3
"""Run HyperDX locally with a configured NetFlow demo source."""

import json
import os
from pathlib import Path
import socket


repo = Path(__file__).resolve().parent.parent
port = None
for candidate in (3000, 3001):
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", candidate))
            port = candidate
            break
        except OSError:
            pass
if port is None:
    raise SystemExit("Ports 3000 and 3001 are occupied; stop an existing demo first")

connection = {
    "id": "netflow-local",
    "name": "Local ClickHouse",
    "host": os.getenv("CLICKHOUSE_URL", "http://127.0.0.1:8123"),
    "username": os.getenv("CLICKHOUSE_USER", "default"),
    "password": os.getenv("CLICKHOUSE_PASSWORD", ""),
}
source = {
    "id": "netflow-demo",
    "kind": "netflow",
    "name": "NetFlow demo",
    "connection": connection["id"],
    "from": {"databaseName": "netflow_demo", "tableName": "flows"},
    "timestampValueExpression": "TimeReceived",
    "defaultTableSelectExpression": "TimeReceived, SrcAddr, DstAddr, Proto, Bytes, Packets",
    "bytesExpression": "Bytes",
    "packetsExpression": "Packets",
    "samplingRateExpression": "SamplingRate",
    "srcAddrExpression": "SrcAddr",
    "dstAddrExpression": "DstAddr",
    "srcPortExpression": "SrcPort",
    "dstPortExpression": "DstPort",
    "protocolExpression": "Proto",
    "exporterExpression": "ExporterName",
    "inIfExpression": "InIfName",
    "outIfExpression": "OutIfName",
}
env = {
    **os.environ,
    "NEXT_PUBLIC_IS_LOCAL_MODE": "true",
    "NEXT_PUBLIC_HDX_LOCAL_DEFAULT_CONNECTIONS": json.dumps([connection]),
    "NEXT_PUBLIC_HDX_LOCAL_DEFAULT_SOURCES": json.dumps([source]),
}
print(f"NetFlow demo: http://127.0.0.1:{port}/netflow", flush=True)
os.chdir(repo / "packages/app")
os.execvpe(
    "node",
    [
        "node",
        str(repo / "node_modules/next/dist/bin/next"),
        "dev",
        "--turbopack",
        "--hostname",
        "127.0.0.1",
        "--port",
        str(port),
    ],
    env,
)
