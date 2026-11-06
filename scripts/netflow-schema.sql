CREATE TABLE IF NOT EXISTS netflow_demo.flows
(
    TimeReceived DateTime('UTC'),
    SamplingRate UInt64,
    ExporterAddress IPv6,
    ExporterName LowCardinality(String),
    ExporterSite LowCardinality(String),
    SrcAddr IPv6,
    DstAddr IPv6,
    SrcAS UInt32,
    DstAS UInt32,
    SrcCountry FixedString(2),
    DstCountry FixedString(2),
    InIfName LowCardinality(String),
    OutIfName LowCardinality(String),
    InIfConnectivity LowCardinality(String),
    OutIfConnectivity LowCardinality(String),
    InIfProvider LowCardinality(String),
    OutIfProvider LowCardinality(String),
    InIfSpeed UInt32,
    OutIfSpeed UInt32,
    InIfBoundary Enum8('undefined' = 0, 'external' = 1, 'internal' = 2),
    OutIfBoundary Enum8('undefined' = 0, 'external' = 1, 'internal' = 2),
    EType UInt32,
    Proto UInt32,
    SrcPort UInt16,
    DstPort UInt16,
    Bytes UInt64,
    Packets UInt64
)
ENGINE = MergeTree
PARTITION BY toDate(TimeReceived)
ORDER BY (TimeReceived, ExporterName, SrcAddr, DstAddr)
COMMENT 'hyperdx-netflow-demo-v1'
