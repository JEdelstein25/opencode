# ClickHouse Import Quick Start

Get CourtListener data into ClickHouse in 3 steps.

## 1. Install ClickHouse

```bash
# macOS
brew install clickhouse
brew services start clickhouse

# Verify installation
clickhouse-client --version
```

## 2. Download Data

```bash
# Download compressed opinion clusters (2.3 GB)
wget https://storage.courtlistener.com/bulk-data/opinion-clusters-2025-10-09.csv.bz2 \
  -O /tmp/opinion-clusters.csv.bz2
```

## 3. Import to ClickHouse

```bash
cd packages/opencode/courtlistener-service
bun run import-clickhouse /tmp/opinion-clusters.csv.bz2
```

Output:
```
✓ ClickHouse client available

Import Configuration:
  Source:      Local
  File:        opinion-clusters-2025-10-09.csv.bz2
  Compression: bz2
  Table:       opinion_clusters_2025_10_09
  Size:        2.30 GB

Starting import...

[12:34:56] 🚀 Preparing to import...
[12:35:01] ⏳ Importing... 50,000 rows (5.0s elapsed)
[12:35:06] ⏳ Importing... 125,000 rows (10.0s elapsed)
...
[12:42:15] ✓ Import completed: 2,450,000 rows in 435.2s

✓ Import completed successfully!
  Rows imported: 2,450,000
  Duration: 435.2s
  Rate: 5,631 rows/sec
```

## 4. Query Your Data

```bash
# Connect to ClickHouse
clickhouse-client

# Count rows
SELECT count() FROM opinion_clusters_2025_10_09;

# Sample data
SELECT case_name, date_filed 
FROM opinion_clusters_2025_10_09 
LIMIT 5;

# Search by date
SELECT * FROM opinion_clusters_2025_10_09
WHERE date_filed >= '2024-01-01'
ORDER BY date_filed DESC
LIMIT 10;
```

## Programmatic Usage

```typescript
import { importToClickHouse } from './clickhouse-indexer'

const result = await importToClickHouse({
  tableName: 'my_table',
  source: {
    type: 'local',
    path: '/tmp/opinion-clusters.csv.bz2',
    compression: 'bz2'
  },
  onProgress: (stats) => {
    if (stats.status === 'importing') {
      console.log(`Progress: ${stats.rowsInserted} rows`)
    }
  }
})

console.log(`Imported ${result.rowsImported} rows`)
```

## Troubleshooting

### "clickhouse-client not found"
```bash
brew install clickhouse
```

### "Connection refused"
```bash
# Start ClickHouse server
brew services start clickhouse

# Check status
brew services list | grep clickhouse
```

### "Table already exists"
```sql
-- Drop table first
DROP TABLE IF EXISTS opinion_clusters_2025_10_09;

-- Then re-run import
```

## What's Next?

- Read [CLICKHOUSE.md](./CLICKHOUSE.md) for detailed documentation
- See [example-clickhouse-import.ts](./example-clickhouse-import.ts) for code examples
- Check [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for architecture details

## Performance Tips

For large datasets (opinions - 50 GB):
1. Import overnight (takes 1-2 hours)
2. Use explicit schema for better compression
3. Add indexes after import for faster queries
4. Consider partitioning by date for time-based queries
