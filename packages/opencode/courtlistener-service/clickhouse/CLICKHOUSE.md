# ClickHouse Indexer

Module for importing compressed CourtListener bulk data into ClickHouse for fast search and analysis.

## Features

- ✅ Import local compressed CSV files (bz2, gz, xz, zstd)
- 🚧 Import from S3 buckets (interface ready, implementation pending)
- ⏱️ Real-time progress tracking (updates every 5 seconds)
- 🔄 Auto-detection of compression formats
- 📊 Performance metrics (rows/sec, duration)

## Prerequisites

Install ClickHouse client:

```bash
# macOS
brew install clickhouse

# Linux
curl https://clickhouse.com/ | sh
```

Start ClickHouse server:

```bash
# macOS
brew services start clickhouse

# Linux
sudo clickhouse start
```

## Quick Start

### CLI Usage

Import a local bz2 file:

```bash
bun run import-to-clickhouse.ts /tmp/opinion-clusters.csv.bz2
```

Import from S3 (coming soon):

```bash
bun run import-to-clickhouse.ts --s3 https://storage.courtlistener.com/bulk-data/opinions.csv.bz2
```

### Programmatic Usage

```typescript
import { importToClickHouse } from './clickhouse-indexer'

const result = await importToClickHouse({
  tableName: 'opinion_clusters',
  source: {
    type: 'local',
    path: '/tmp/opinion-clusters.csv.bz2',
    compression: 'bz2'
  },
  onProgress: (stats) => {
    console.log(`${stats.status}: ${stats.rowsInserted} rows`)
  }
})

console.log(`Imported ${result.rowsImported} rows in ${result.durationSeconds}s`)
```

### Custom Table Schema

For better performance, define an explicit schema:

```typescript
const createTableSQL = `
  CREATE TABLE opinion_clusters (
    id UInt64,
    date_created DateTime,
    cluster_id UInt32,
    case_name String,
    plain_text String CODEC(ZSTD(3))
  )
  ENGINE = MergeTree()
  PARTITION BY toYYYYMM(date_created)
  ORDER BY (cluster_id, date_created, id)
`

const result = await importToClickHouse({
  tableName: 'opinion_clusters',
  source: { type: 'local', path: '/tmp/file.csv.bz2', compression: 'bz2' },
  createTableSQL
})
```

## Supported Compression Formats

| Format | Extension | Support Status |
|--------|-----------|----------------|
| bzip2  | `.bz2`    | ✅ Implemented  |
| gzip   | `.gz`     | 🚧 Interface only |
| xz     | `.xz`     | 🚧 Interface only |
| zstd   | `.zst`, `.zstd` | 🚧 Interface only |

## Progress Tracking

The importer provides real-time progress updates:

```typescript
onProgress: (stats) => {
  console.log(`
    Status: ${stats.status}
    Rows: ${stats.rowsInserted}
    Elapsed: ${stats.elapsedSeconds}s
    Message: ${stats.message}
  `)
}
```

Progress is reported:
- At least every 5 seconds during import
- On status changes (starting → importing → completed)
- On errors

## Performance Tips

1. **Use explicit schemas** instead of auto-inference
2. **Partition large tables** by date for faster queries
3. **Apply ZSTD compression** to large text fields
4. **Tune import settings** for your hardware:

```typescript
settings: {
  max_insert_threads: 8,        // Use more threads on powerful machines
  max_insert_block_size: 1048576  // Larger blocks for bulk inserts
}
```

## Architecture

The module consists of three main components:

1. **DataSource**: Defines where data comes from (local file or S3)
2. **ImportOptions**: Configuration for the import operation
3. **Progress Tracking**: Real-time status updates

```mermaid
graph LR
    A[Compressed CSV] --> B[ClickHouse Client]
    B --> C[Auto-decompress]
    C --> D[Parse CSV]
    D --> E[Insert into Table]
    E --> F[Progress Updates]
    F --> G[Completion]
```

## Examples

### Import Opinion Clusters

```bash
# Download from CourtListener
wget https://storage.courtlistener.com/bulk-data/opinion-clusters-2025-10-09.csv.bz2 \
  -O /tmp/opinion-clusters.csv.bz2

# Import to ClickHouse
bun run import-to-clickhouse.ts /tmp/opinion-clusters.csv.bz2
```

### Query After Import

```sql
-- Connect to ClickHouse
clickhouse-client

-- Count rows
SELECT count() FROM opinion_clusters_2025_10_09;

-- Search by date
SELECT * FROM opinion_clusters_2025_10_09
WHERE date_filed >= '2020-01-01'
LIMIT 10;

-- Full-text search (if indexed)
SELECT * FROM opinion_clusters_2025_10_09
WHERE plain_text LIKE '%habeas corpus%'
LIMIT 10;
```

## Troubleshooting

### ClickHouse client not found

```bash
# Check if installed
clickhouse-client --version

# Install if missing (macOS)
brew install clickhouse
```

### File not found error

```bash
# Verify file exists and path is absolute
ls -lh /tmp/opinion-clusters.csv.bz2
```

### Import failed with "Table already exists"

```sql
-- Drop existing table
DROP TABLE IF EXISTS opinion_clusters;

-- Or use IF NOT EXISTS in createTableSQL
CREATE TABLE IF NOT EXISTS ...
```

## Future Enhancements

- [ ] Implement S3 source import
- [ ] Add support for gz, xz, zstd compression
- [ ] Parallel chunk processing
- [ ] Resume interrupted imports
- [ ] Schema auto-detection improvements
- [ ] Optimized table structures for each dataset type
