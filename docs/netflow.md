# NetFlow monitoring

The NetFlow section queries a configured ClickHouse table through HyperDX's
existing connections and source mappings. An Akvorado `flows` table can be used
directly. HyperDX does not collect UDP NetFlow, IPFIX, or sFlow packets: keep
Akvorado or another collector responsible for decoding and ingestion.

## Local demo

Use Python 3, the repository's Node/Yarn dependencies, and a local ClickHouse
server with HTTP access and browser CORS enabled. The demo uses
`http://127.0.0.1:8123`, user `default`, and an empty password. Override these
with `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, and `CLICKHOUSE_PASSWORD` as needed.
Local mode sends these credentials to the browser, so use a local development
account.

From the repository root:

```sh
yarn setup
yarn build:common-utils
python3 scripts/netflow-seed.py
python3 scripts/netflow-dev.py
```

The launcher prints the URL, normally `http://127.0.0.1:3000/netflow`, and uses
port 3001 if 3000 is occupied. It supplies the connection and native NetFlow
source through HyperDX's supported default configuration environment variables.
No MongoDB, API server, account registration, or browser storage edits are
needed for this local demo. A fresh browser session uses these defaults;
previously saved local connections and sources take precedence.

Choose the last two hours to see the whole fixture, including its TCP traffic
burst. Re-run the seeder to move the data to the current time. The seeder
replaces only its own `netflow_demo.flows` table, checking its ownership comment
first. It refuses remote endpoints and does not modify other databases or
tables. Refreshes do not accumulate duplicate records. A failed insert can leave
this disposable fixture table empty; re-run the seeder to restore it.

For a fixed, reproducible time range:

```sh
python3 scripts/netflow-seed.py --end 2026-10-09T18:34:38Z
```

This produces the UTC interval `[2026-10-09 16:34:38, 2026-10-09 18:34:38)`. The
last stored timestamp is `18:34:37`; use that absolute range when inspecting
this fixed fixture after its timestamps leave the relative time window.

## Data and sampling

The data is deterministic synthetic traffic generated locally, not a packet
capture or customer traffic. The schema follows
[Akvorado's flow schema](https://github.com/akvorado/akvorado/blob/main/common/schema/definition.go),
using documentation IP ranges and private AS numbers. The fixture includes
14,400 records across three exporters, TCP, UDP, ICMP, ICMPv6, inbound and
outbound interfaces, IPv4-mapped IPv6 addresses, and native IPv6 addresses.
Interface classification columns (`InIfConnectivity`, `OutIfConnectivity`,
`InIfProvider`, `OutIfProvider`) contain deterministic transit, IX, and PNI
classifications with synthetic provider names tied to each exporter. As with
Akvorado's default classifier, internal interfaces leave these fields empty. The
seeder adds missing classification columns only after confirming ownership of
the demo table; existing counters and record counts stay unchanged. Interface
speeds are stored in Mbps, as in Akvorado. `ExporterAddress` uses plain `IPv6`
to work without ClickHouse's optional low-cardinality IPv6 setting.

`Bytes` and `Packets` hold observed counters. `SamplingRate` holds the expansion
factor (1, 100, or 1,000). Traffic estimates are `sum(Bytes * SamplingRate)` and
`sum(Packets * SamplingRate)`, matching
[Akvorado's aggregation](https://github.com/akvorado/akvorado/blob/main/console/widgets.go).
Multiply estimated bytes by eight and divide by the requested duration in
seconds for bits per second. The record count is the number of stored records,
not an estimate of distinct connections or sampling-expanded flows.

The seeder checks actual ClickHouse query results against generated totals:

| Measurement         |    Expected value |
| ------------------- | ----------------: |
| Records             |            14,400 |
| Exporters           |                 3 |
| Protocols           |                 4 |
| Native IPv6 records |             2,572 |
| Observed bytes      |     7,572,836,640 |
| Observed packets    |         9,162,160 |
| Estimated bytes     | 2,776,744,315,920 |
| Estimated packets   |     3,359,797,180 |

## Source configuration

The NetFlow search bar uses the same Lucene syntax, field autocomplete, query
history, and syntax reference as log Search. Focus the search bar to see table
columns; type a prefix to narrow them, then click a suggestion or use the arrow
keys and Enter/Tab. After a column and colon, matching values are suggested.
Press Enter or Run to apply the query to all charts and flow records. Queries
combine with the exporter, protocol, and address filters using AND; Clear
filters resets both the search and quick filters. The query and selected
language are saved in the URL. The shared language selector also supports SQL
WHERE expressions. Bare terms search the mapped addresses, ports, protocol,
exporter, and interfaces. Set the optional **Full-text search expression** in
the source editor to search a different expression.

Click an IP address, protocol, exporter, or interface in a breakdown chart, flow
row, or flow details to **Include** or **Exclude** it. These actions apply
immediately while preserving the search query and time range. Selected values
appear as removable filters and survive URL sharing and reloads. Multiple
included values for the same field use OR; different fields and exclusions use
AND. Clear filters also removes these selections.

Use your table's actual field names, for example with the Akvorado schema:

```text
Proto:6 AND DstPort:443
ExporterName:edge* AND Bytes:[1000 TO 100000]
(DstPort:80 OR DstPort:443) AND NOT Proto:17
```

In the source editor, select NetFlow, a ClickHouse connection, and the desired
database/table. Use these Akvorado mappings:

| Source setting               | Column/expression        |
| ---------------------------- | ------------------------ |
| Timestamp                    | `TimeReceived`           |
| Bytes / packets              | `Bytes` / `Packets`      |
| Sampling rate                | `SamplingRate`           |
| Source / destination address | `SrcAddr` / `DstAddr`    |
| Source / destination port    | `SrcPort` / `DstPort`    |
| Protocol                     | `Proto`                  |
| Exporter                     | `ExporterName`           |
| Input / output interface     | `InIfName` / `OutIfName` |

For already sampling-adjusted counters, omit the sampling-rate mapping to avoid
expanding the counters twice. Full deployments persist the source through the
existing authenticated source API and MongoDB model.

Traffic rates use the seconds covered by each bucket within the selected time
range, including partial first and last buckets. Flow records display and sort
by the first timestamp expression when multiple timestamp mappings are
configured.

## Sankey visualization

Select **Sankey** in the NetFlow visualization selector to explore traffic
paths. Choose two to five dimensions in left-to-right order from the source
mappings or scalar table columns. Akvorado tables default to `SrcAS` →
`InIfConnectivity` → `InIfProvider` → exporter when those columns are available.

Link widths represent sampling-adjusted bytes for the top 10, 20, or 50 paths.
The table and tooltips show transferred bytes and average bit rate over the
selected time range. Paths outside the limit are omitted from the diagram. Click
a node or table value to include or exclude it using the shared filters; Lucene
search, quick filters, and the time range also apply to this view. The
visualization, ordered dimensions, and path limit are saved in the URL.

The path limit bounds returned paths, not the number of groups ClickHouse
aggregates. For high-cardinality dimensions or wide ranges, configure
`max_memory_usage` and `max_bytes_before_external_group_by` through the
connection's query settings.

A local validation with two million flow records, five dimensions, and a 30-day
range completed in 0.71 seconds while reading 106 MB, with a 512 MiB memory cap
and a 64 MiB external aggregation threshold. This checks that configuration on
the local fixture; it is not a production performance guarantee.

## Automated verification

The NetFlow browser and ClickHouse query checks run in the existing Playwright
suite and are discovered by CI. Each test creates and tears down its own
ClickHouse database and source configuration; the demo seeder is not required.

```sh
make dev-e2e FILE=netflow
```

The suite checks sampled overview totals and raw counters, every chart query,
IPv4/IPv6 filters, literal escaping, Lucene and SQL composition, Sankey traffic
conservation, empty classifications, source switching, pending query drafts, URL
reloads, invalid time ranges, partial-bucket rates, timestamp expression lists,
flow details, and chart axes at wide and narrow viewport sizes. Failures use the
normal Playwright screenshots, traces, and reports under
`packages/app/test-results/`.
