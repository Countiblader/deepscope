CREATE DATABASE IF NOT EXISTS deepscope;

CREATE TABLE IF NOT EXISTS deepscope.ais_positions (
    timestamp DateTime64(3, 'UTC'),
    mmsi UInt32,
    ship_name String,
    ship_type UInt16,
    flag LowCardinality(String),
    latitude Float32,
    longitude Float32,
    sog Float32,
    cog Float32,
    heading Float32,
    nav_status UInt8,
    destination String,
    draught Float32,
    imo UInt32,
    zone LowCardinality(Nullable(String))
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (mmsi, timestamp)
TTL timestamp + INTERVAL 2 YEAR;

CREATE TABLE IF NOT EXISTS deepscope.vessel_metadata (
    mmsi UInt32,
    ship_name String,
    ship_type UInt16,
    flag LowCardinality(String),
    imo UInt32,
    call_sign String,
    destination String,
    draught Float32,
    dimension_a UInt16,
    dimension_b UInt16,
    dimension_c UInt16,
    dimension_d UInt16,
    first_seen DateTime64(3, 'UTC'),
    last_seen DateTime64(3, 'UTC'),
    risk_score Float32 DEFAULT 0
) ENGINE = ReplacingMergeTree(last_seen)
ORDER BY mmsi;

CREATE TABLE IF NOT EXISTS deepscope.price_data (
    timestamp DateTime64(3, 'UTC'),
    symbol LowCardinality(String),
    price Float64,
    currency LowCardinality(String),
    source LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp);

CREATE TABLE IF NOT EXISTS deepscope.news_events (
    timestamp DateTime64(3, 'UTC'),
    title String,
    url String,
    source String,
    domain LowCardinality(String),
    sentiment_score Float32,
    sentiment LowCardinality(String),
    keywords Array(String),
    language LowCardinality(String)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY timestamp;

CREATE TABLE IF NOT EXISTS deepscope.intelligence_alerts (
    timestamp DateTime64(3, 'UTC'),
    type LowCardinality(String),
    severity LowCardinality(String),
    title String,
    description String,
    evidence String,
    resolved UInt8 DEFAULT 0
) ENGINE = MergeTree()
ORDER BY (timestamp, type);
