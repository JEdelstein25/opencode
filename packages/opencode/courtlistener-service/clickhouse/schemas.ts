/**
 * ClickHouse table schemas for CourtListener bulk data.
 *
 * These schemas are optimized versions of CourtListener's PostgreSQL schema,
 * adapted for ClickHouse's columnar storage and compression.
 */

/**
 * Schema for opinion-clusters data
 * Original PostgreSQL table: search_opinioncluster
 */
export const OPINION_CLUSTER_SCHEMA = `
CREATE TABLE IF NOT EXISTS opinion_clusters
(
    id UInt32,
    judges String,
    date_created DateTime,
    date_modified DateTime,
    date_filed Date,
    slug LowCardinality(String),
    case_name_short String,
    case_name String CODEC(ZSTD(1)),
    case_name_full String CODEC(ZSTD(1)),
    scdb_id LowCardinality(String),
    source LowCardinality(String),
    procedural_history String CODEC(ZSTD(3)),
    attorneys String CODEC(ZSTD(3)),
    nature_of_suit String CODEC(ZSTD(1)),
    posture String CODEC(ZSTD(3)),
    syllabus String CODEC(ZSTD(3)),
    citation_count UInt32,
    precedential_status LowCardinality(String),
    date_blocked Nullable(Date),
    blocked UInt8,
    docket_id UInt32,
    scdb_decision_direction Nullable(Int32),
    scdb_votes_majority Nullable(UInt8),
    scdb_votes_minority Nullable(UInt8),
    date_filed_is_approximate UInt8,
    correction String CODEC(ZSTD(3)),
    cross_reference String CODEC(ZSTD(3)),
    disposition String CODEC(ZSTD(1)),
    filepath_json_harvard LowCardinality(String),
    headnotes String CODEC(ZSTD(3)),
    history String CODEC(ZSTD(3)),
    other_dates String CODEC(ZSTD(3)),
    summary String CODEC(ZSTD(3)),
    arguments String CODEC(ZSTD(3)),
    headmatter String CODEC(ZSTD(3)),
    filepath_pdf_harvard LowCardinality(String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date_filed)
ORDER BY (date_filed, docket_id, id)
PRIMARY KEY (date_filed, docket_id)
SETTINGS index_granularity = 8192
`

/**
 * Schema for opinions data
 * Original PostgreSQL table: search_opinion
 */
export const OPINION_SCHEMA = `
CREATE TABLE IF NOT EXISTS opinions
(
    id UInt32,
    date_created DateTime,
    date_modified DateTime,
    type LowCardinality(String),
    sha1 String,
    download_url Nullable(String),
    local_path LowCardinality(String),
    plain_text String CODEC(ZSTD(3)),
    html String CODEC(ZSTD(3)),
    html_lawbox String CODEC(ZSTD(3)),
    html_columbia String CODEC(ZSTD(3)),
    html_with_citations String CODEC(ZSTD(3)),
    extracted_by_ocr UInt8,
    author_id Nullable(UInt32),
    cluster_id UInt32,
    per_curiam UInt8,
    page_count Nullable(UInt32),
    author_str String,
    joined_by_str String,
    xml_harvard String CODEC(ZSTD(3)),
    html_anon_2020 String CODEC(ZSTD(3)),
    ordering_key Nullable(UInt32),
    main_version_id Nullable(UInt32)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date_created)
ORDER BY (cluster_id, date_created, id)
PRIMARY KEY (cluster_id, date_created)
SETTINGS index_granularity = 8192
`

/**
 * Schema for dockets data
 */
export const DOCKET_SCHEMA = `
CREATE TABLE IF NOT EXISTS dockets
(
    id UInt32,
    date_created DateTime,
    date_modified DateTime,
    source LowCardinality(String),
    appeal_from_str String,
    assigned_to_str String,
    referred_to_str String,
    panel_str String,
    date_last_index Nullable(Date),
    date_cert_granted Nullable(Date),
    date_cert_denied Nullable(Date),
    date_argued Nullable(Date),
    date_reargued Nullable(Date),
    date_reargument_denied Nullable(Date),
    date_filed Nullable(Date),
    date_terminated Nullable(Date),
    date_last_filing Nullable(Date),
    case_name_short String,
    case_name String CODEC(ZSTD(1)),
    case_name_full String CODEC(ZSTD(1)),
    slug LowCardinality(String),
    docket_number LowCardinality(String),
    docket_number_core LowCardinality(String),
    pacer_case_id LowCardinality(String),
    cause String,
    nature_of_suit String,
    jury_demand String,
    jurisdiction_type LowCardinality(String),
    appellate_fee_status LowCardinality(String),
    appellate_case_type_information LowCardinality(String),
    mdl_status LowCardinality(String),
    filepath_local LowCardinality(String),
    filepath_ia LowCardinality(String),
    filepath_ia_json LowCardinality(String),
    ia_upload_failure_count Nullable(UInt8),
    ia_needs_upload Nullable(UInt8),
    ia_date_first_change Nullable(DateTime),
    view_count UInt32,
    date_blocked Nullable(Date),
    blocked UInt8,
    appeal_from_id Nullable(UInt16),
    assigned_to_id Nullable(UInt32),
    court_id LowCardinality(String),
    idb_data_id Nullable(UInt32),
    originating_court_information_id Nullable(UInt32),
    referred_to_id Nullable(UInt32)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date_filed)
ORDER BY (court_id, date_filed, id)
PRIMARY KEY (court_id, date_filed)
SETTINGS index_granularity = 8192
`

/**
 * Get schema SQL for a specific dataset
 */
export function getSchemaForDataset(datasetName: string): string | null {
	const schemaMap: Record<string, string> = {
		'opinion-clusters': OPINION_CLUSTER_SCHEMA,
		'opinion_clusters': OPINION_CLUSTER_SCHEMA,
		opinions: OPINION_SCHEMA,
		dockets: DOCKET_SCHEMA,
	}

	return schemaMap[datasetName] || null
}

/**
 * Type definitions for schema tradeoffs and considerations
 */
export interface SchemaOptimization {
	field: string
	postgresType: string
	clickhouseType: string
	reason: string
	tradeoff?: string
}

/**
 * Documentation of schema optimization decisions
 */
export const SCHEMA_OPTIMIZATIONS: SchemaOptimization[] = [
	{
		field: 'id',
		postgresType: 'integer',
		clickhouseType: 'UInt32',
		reason: 'IDs are always positive, UInt32 saves space and is faster',
	},
	{
		field: 'plain_text, html',
		postgresType: 'text',
		clickhouseType: 'String CODEC(ZSTD(3))',
		reason: 'Large text fields compress 3-5x with ZSTD',
		tradeoff: 'Slightly higher CPU cost on read, but 3-5x storage savings',
	},
	{
		field: 'source, type, precedential_status',
		postgresType: 'varchar',
		clickhouseType: 'LowCardinality(String)',
		reason: 'Few unique values (<10k), creates dictionary encoding',
		tradeoff: '30-50% faster queries, less memory, but adds dictionary overhead for high-cardinality fields',
	},
	{
		field: 'blocked, extracted_by_ocr, per_curiam',
		postgresType: 'boolean',
		clickhouseType: 'UInt8',
		reason: 'ClickHouse has no native boolean, UInt8 (0/1) is standard',
	},
	{
		field: 'author_id, scdb_decision_direction',
		postgresType: 'integer',
		clickhouseType: 'Nullable(UInt32)',
		reason: 'Only nullable when truly optional - avoids 8-byte overhead per row',
		tradeoff: 'Nullable adds overhead but required for NULL values',
	},
	{
		field: 'date_filed, date_created',
		postgresType: 'timestamp',
		clickhouseType: 'Date / DateTime',
		reason: 'Date uses 2 bytes vs DateTime 4 bytes when time not needed',
	},
]

/**
 * Partitioning strategy recommendations
 */
export const PARTITIONING_NOTES = `
Partitioning Strategy:

1. opinion_clusters: PARTITION BY toYYYYMM(date_filed)
   - Enables fast date range queries
   - Easier to drop old data if needed
   - Typical queries filter by date

2. opinions: PARTITION BY toYYYYMM(date_created)
   - Aligns with data growth pattern
   - Enables efficient archival
   - ~12-50 partitions total (manageable)

3. dockets: PARTITION BY toYYYYMM(date_filed)
   - Similar reasoning to clusters
   - Court + date is common query pattern

Tradeoff: Monthly partitions balance between:
- Too few partitions = no benefit
- Too many partitions (>1000) = merge performance degradation
`

/**
 * Indexing strategy recommendations
 */
export const INDEXING_NOTES = `
Primary Key Strategy:

1. opinion_clusters: ORDER BY (date_filed, docket_id, id)
   - Date range filtering is most common
   - docket_id groups related clusters
   - id for uniqueness

2. opinions: ORDER BY (cluster_id, date_created, id)
   - cluster_id groups related opinions
   - Date for temporal ordering
   - Most queries join to clusters

3. For full-text search, add secondary indexes:
   ALTER TABLE opinions 
   ADD INDEX plain_text_idx plain_text 
   TYPE tokenbf_v1(30720, 3, 0) 
   GRANULARITY 1;

Tradeoff:
- Primary key affects both sort order AND sparse index
- Choose based on most common query patterns
- Can't change without rebuilding table
`
