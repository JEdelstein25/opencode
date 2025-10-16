# ClickHouse Indexer Implementation Summary

## Overview

Created a modular ClickHouse indexer for importing compressed CourtListener bulk data with real-time progress tracking.

## Files Created

### Core Module
- **`clickhouse-indexer.ts`** - Main module with all indexing logic
  - `importToClickHouse()` - Primary import function
  - `checkClickHouseAvailable()` - Verify ClickHouse installation
  - `detectCompressionFormat()` - Auto-detect compression from filename
  - `formatBytes()` - Human-readable file sizes
  - Progress tracking with 5-second intervals

### CLI Tools
- **`import-to-clickhouse.ts`** - Standalone CLI tool for imports
  - Supports local files: `bun run import-to-clickhouse.ts /path/file.csv.bz2`
  - S3 interface ready: `bun run import-to-clickhouse.ts --s3 <url>`
  - Real-time progress display with timestamps

### Examples & Tests
- **`example-clickhouse-import.ts`** - Detailed usage example with comments
- **`clickhouse-indexer.test.ts`** - Unit tests for utility functions
- **`CLICKHOUSE.md`** - Complete documentation

## Interface Design

### DataSource (Flexible)
```typescript
interface DataSource {
  type: 'local' | 's3'
  path: string
  compression: 'bz2' | 'gz' | 'xz' | 'zstd' | 'none'
}
```

### Progress Tracking (5-Second Updates)
```typescript
interface ImportProgress {
  status: 'starting' | 'importing' | 'completed' | 'failed'
  rowsInserted?: number
  bytesProcessed?: number
  elapsedSeconds?: number
  message?: string
}
```

## Implementation Status

### ✅ Implemented
- [x] Local bzip2 (.bz2) file import
- [x] Progress tracking (5-second intervals)
- [x] Compression auto-detection
- [x] ClickHouse availability check
- [x] CLI tool with user-friendly output
- [x] Unit tests
- [x] Documentation

### 🚧 Interface Ready (Not Yet Implemented)
- [ ] S3 source import
- [ ] gzip (.gz) compression
- [ ] xz (.xz) compression  
- [ ] zstd (.zst, .zstd) compression

## Usage Examples

### Basic Import
```bash
bun run import-clickhouse /tmp/opinion-clusters.csv.bz2
```

### Programmatic Usage
```typescript
import { importToClickHouse } from './clickhouse-indexer'

const result = await importToClickHouse({
  tableName: 'opinions',
  source: {
    type: 'local',
    path: '/tmp/opinions.csv.bz2',
    compression: 'bz2'
  },
  onProgress: (stats) => {
    console.log(`${stats.status}: ${stats.rowsInserted} rows`)
  }
})
```

### With Custom Schema
```typescript
const createTableSQL = `
  CREATE TABLE opinions (
    id UInt64,
    plain_text String CODEC(ZSTD(3)),
    date_filed Date
  )
  ENGINE = MergeTree()
  ORDER BY (date_filed, id)
`

await importToClickHouse({
  tableName: 'opinions',
  source: { type: 'local', path: '/tmp/file.csv.bz2', compression: 'bz2' },
  createTableSQL
})
```

## Key Features

### 1. Real-Time Progress
- Updates at least every 5 seconds
- Shows rows imported, elapsed time, rate
- Timestamped log entries

### 2. Flexible Architecture
- Works with local files and S3 (interface ready)
- Supports multiple compression formats
- Extensible for new data sources

### 3. Production-Ready
- Error handling with detailed messages
- Availability checks before operations
- Unit tested utility functions
- Comprehensive documentation

## Performance Characteristics

### Local bz2 Import
- **Compression overhead**: bzip2 decompression ~5-15 MB/s per core
- **Import rate**: Varies by data (typically 10k-100k rows/sec)
- **Storage**: ClickHouse columnar ~same size as original bz2

### Expected Performance
- 2.3 GB bz2 file → ~1-2 hour import
- Progress updates every 5 seconds
- Final ClickHouse table: ~2-4 GB

## Next Steps to Complete Full Implementation

### 1. Add S3 Support
```typescript
// In buildImportSQL(), already handles S3:
if (source.type === 's3') {
  sql += `s3('${source.path}', CSVWithNames${compressionParam})`
}
```

Just needs testing and credentials handling.

### 2. Add Other Compression Formats
```typescript
// Already detects all formats:
function detectCompressionFormat(filename: string): CompressionFormat {
  if (ext.endsWith('.gz')) return 'gz'  // Add implementation
  if (ext.endsWith('.xz')) return 'xz'  // Add implementation
  // etc.
}
```

ClickHouse supports all these natively, just needs testing.

### 3. Optimize Table Schemas
Create optimized schemas for each CourtListener dataset:
- `opinions`: Text-heavy with ZSTD compression
- `opinion-clusters`: Metadata with LowCardinality strings
- `dockets`: Time-series with date partitioning

## Testing

```bash
# Run unit tests
bun test clickhouse-indexer.test.ts

# Run example (requires ClickHouse + data file)
bun run example-clickhouse-import.ts

# Test CLI tool
bun run import-clickhouse /tmp/test.csv.bz2
```

## Dependencies

### Required
- Bun runtime
- ClickHouse client (`brew install clickhouse`)
- ClickHouse server (local or remote)

### Optional
- wget/curl for downloading bulk data
- AWS CLI for S3 access (future)

## Architecture Diagram

```
┌─────────────────┐
│ Compressed CSV  │
│  (.bz2/.gz/etc) │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ ClickHouse      │◄── Progress tracking
│ Client Process  │    (every 5 seconds)
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Auto-decompress │
│ + Parse CSV     │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Insert into     │
│ MergeTree Table │
└─────────────────┘
```

## Notes for Future Development

1. **S3 Implementation**: The interface is ready. Main work is:
   - Handle S3 URLs (already in buildImportSQL)
   - Add AWS credential configuration
   - Test with actual S3 buckets

2. **Compression Formats**: ClickHouse supports all formats natively. To add:
   - No code changes needed in core logic
   - Just add tests for each format
   - Update documentation

3. **Schema Optimization**: For production use:
   - Define explicit schemas per dataset
   - Use appropriate compression codecs
   - Add proper partitioning
   - Create relevant indexes

4. **Parallel Processing**: Future enhancement:
   - Split large files into chunks
   - Process chunks in parallel
   - Merge results

## Conclusion

✅ **Core implementation complete** for local bz2 files  
✅ **Interface ready** for S3 and other formats  
✅ **Progress tracking** working with 5-second updates  
✅ **Well-documented** with examples and tests  

Ready for immediate use with local bz2 files. Other formats/sources can be added with minimal effort.
