#!/usr/bin/env python3
"""Seed and verify synthetic Akvorado-compatible flows in local ClickHouse."""

import argparse
import base64
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--url", default=os.getenv("CLICKHOUSE_URL", "http://127.0.0.1:8123")
)
parser.add_argument(
    "--end", help="Exclusive UTC end time, e.g. 2026-10-09T20:00:00Z (default: now)"
)
args = parser.parse_args()
if urlparse(args.url).hostname not in ("localhost", "127.0.0.1", "::1"):
    parser.error("The demo seeder only writes to a local ClickHouse server")

end = (
    datetime.fromisoformat(args.end.replace("Z", "+00:00"))
    if args.end
    else datetime.now(timezone.utc)
)
if end.tzinfo is None:
    parser.error("--end must include a timezone")
end = end.astimezone(timezone.utc).replace(microsecond=0)
start = end - timedelta(hours=2)
credentials = base64.b64encode(
    f"{os.getenv('CLICKHOUSE_USER', 'default')}:{os.getenv('CLICKHOUSE_PASSWORD', '')}".encode()
).decode()


def query(sql):
    request = Request(
        args.url,
        data=sql.encode(),
        headers={"Authorization": f"Basic {credentials}"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=60) as response:
            return response.read().decode().strip()
    except HTTPError as error:
        raise SystemExit(error.read().decode()) from error


rows = []
for i in range(14400):
    exporter = i % 3
    scenario = i % 10
    proto = 6 if scenario < 6 else 17 if scenario < 9 else 58 if (i // 10) % 2 else 1
    ipv6 = proto == 58 or (proto != 1 and i % 7 == 0)
    inbound = i % 4 == 0
    internal = (
        f"2001:db8:1::{i % 48 + 1:x}"
        if ipv6
        else f"::ffff:192.0.2.{i % 48 + 1}"
    )
    external = (
        f"2001:db8:2::{i % 24 + 1:x}"
        if ipv6
        else f"::ffff:203.0.113.{i % 24 + 1}"
    )
    packets = 20 + (i * 17) % 980
    # A short bulk-transfer burst makes the time series useful for investigation.
    if 9000 <= i < 10200 and proto == 6:
        packets *= 6
    packet_size = 1100 if proto == 6 else 300 if proto == 17 else 84
    service_port = 443 if proto == 6 else 53 if proto == 17 else 0
    client_port = 32768 + i % 28000 if proto in (6, 17) else 0
    connectivity = ("transit", "ix", "pni")[exporter]
    provider = ("transit-west", "ix-frankfurt", "peer-east")[exporter]
    rows.append(
        {
            "TimeReceived": (start + timedelta(seconds=i // 2)).strftime(
                "%Y-%m-%d %H:%M:%S"
            ),
            "SamplingRate": (1, 100, 1000)[exporter],
            "ExporterAddress": f"::ffff:198.51.100.{exporter + 1}",
            "ExporterName": ("edge-sfo-01", "edge-fra-01", "core-iad-01")[exporter],
            "ExporterSite": ("sfo", "fra", "iad")[exporter],
            "SrcAddr": external if inbound else internal,
            "DstAddr": internal if inbound else external,
            "SrcAS": 64501 if inbound else 64500,
            "DstAS": 64500 if inbound else 64501,
            "SrcCountry": "DE" if inbound else "US",
            "DstCountry": "US" if inbound else "DE",
            "InIfName": "xe-0/0/0" if inbound else "ae1",
            "OutIfName": "ae1" if inbound else "xe-0/0/0",
            "InIfConnectivity": connectivity if inbound else "",
            "OutIfConnectivity": "" if inbound else connectivity,
            "InIfProvider": provider if inbound else "",
            "OutIfProvider": "" if inbound else provider,
            "InIfSpeed": 10000,
            "OutIfSpeed": 10000,
            "InIfBoundary": "external" if inbound else "internal",
            "OutIfBoundary": "internal" if inbound else "external",
            "EType": 0x86DD if ipv6 else 0x800,
            "Proto": proto,
            "SrcPort": service_port if inbound else client_port,
            "DstPort": client_port if inbound else service_port,
            "Bytes": packets * packet_size,
            "Packets": packets,
        }
    )

query("CREATE DATABASE IF NOT EXISTS netflow_demo")
query(Path(__file__).with_name("netflow-schema.sql").read_text())
owner = query(
    "SELECT comment FROM system.tables "
    "WHERE database = 'netflow_demo' AND name = 'flows' FORMAT TabSeparated"
)
if owner != "hyperdx-netflow-demo-v1":
    raise SystemExit("Refusing to replace a table not owned by this demo seeder")

query(
    "ALTER TABLE netflow_demo.flows "
    + ", ".join(
        f"ADD COLUMN IF NOT EXISTS {column} LowCardinality(String)"
        for column in (
            "InIfConnectivity", "OutIfConnectivity", "InIfProvider", "OutIfProvider"
        )
    )
)

# This isolated table contains only disposable generated fixtures.
query("TRUNCATE TABLE netflow_demo.flows")
query(
    "INSERT INTO netflow_demo.flows FORMAT JSONEachRow\n"
    + "\n".join(json.dumps(row) for row in rows)
)
actual = json.loads(
    query(
        "SELECT count() AS records, sum(Bytes) AS raw_bytes, "
        "sum(Packets) AS raw_packets, sum(Bytes * SamplingRate) AS estimated_bytes, "
        "sum(Packets * SamplingRate) AS estimated_packets, "
        "uniqExact(ExporterName) AS exporters, uniqExact(Proto) AS protocols, "
        "countIf(EType = 34525) AS ipv6_records, "
        "uniqExact(InIfConnectivity) AS input_connectivity_classes, "
        "uniqExact(OutIfConnectivity) AS output_connectivity_classes, "
        "uniqExact(InIfProvider) AS input_provider_classes, "
        "uniqExact(OutIfProvider) AS output_provider_classes, "
        "min(TimeReceived) AS first, max(TimeReceived) AS last "
        "FROM netflow_demo.flows FORMAT JSONEachRow"
    )
)
expected = {
    "records": len(rows),
    "raw_bytes": sum(row["Bytes"] for row in rows),
    "raw_packets": sum(row["Packets"] for row in rows),
    "estimated_bytes": sum(row["Bytes"] * row["SamplingRate"] for row in rows),
    "estimated_packets": sum(row["Packets"] * row["SamplingRate"] for row in rows),
    "exporters": 3,
    "protocols": 4,
    "ipv6_records": sum(row["EType"] == 0x86DD for row in rows),
    "input_connectivity_classes": 4,
    "output_connectivity_classes": 4,
    "input_provider_classes": 4,
    "output_provider_classes": 4,
}
for field, value in expected.items():
    if int(actual[field]) != value:
        raise SystemExit(f"Verification failed for {field}: {actual[field]} != {value}")
print(json.dumps({"verified": True, "table": "netflow_demo.flows", **actual}, indent=2))
