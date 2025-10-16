# CourtListener CSV Loading Issue

## Problem

CourtListener's PostgreSQL CSV exports are **incompatible with ClickHouse's CSV parser** due to:

1. **Multiline quoted fields** - HTML content spans multiple lines
2. **Complex quoting** - PostgreSQL-style escaping (`""` for quotes)
3. **Embedded delimiters** - Commas and quotes inside HTML fields

### Example Row That Fails

```csv
"9938434","2024-06-27","2024-06-27","","2023-03-22","f","slug","short","CASE NAME","FULL NAME","","",,,,"G","<em>
     John B. Faust, Jr.,
    </em>","attorneys","","","syllabus","headnotes","summary","","","","","","0","Unknown",,"f","","","59959270","",""
```

ClickHouse expects: `"9938434","2024-06-27",...`  
But gets: Multiline HTML breaking the parser after 10,000 error limit.

## Solutions

### ✅ Option 1: Preprocess CSV (Recommended)

Create a Node.js script to convert PostgreSQL CSV → ClickHouse-compatible format:

```typescript
import {createReadStream} from 'bun'
import {parse} from 'csv-parse'
import {stringify} from 'csv-stringify'

// Strip HTML and normalize multiline fields
const transformer = (record) => {
  return record.map(field => {
    // Remove HTML tags
    const cleaned = field.replace(/<[^>]+>/g, '')
    // Replace newlines with spaces
    return cleaned.replace(/\n/g, ' ').trim()
  })
}

// Process and save
```

### ✅ Option 2: Use ClickHouse Cloud Import

ClickHouse Cloud has better PostgreSQL CSV support with `input_format_csv_use_best_effort_in_schema_inference`.

### ✅ Option 3: Convert CSV to NDJSON

Use existing `build-index.ts` logic to parse PostgreSQL CSV correctly:

```bash
# Parse CSV properly in Node.js, output NDJSON
bun preprocess-csv.ts opinion-clusters-2025-10-09.csv.bz2 > opinion-clusters.ndjson

# Import NDJSON (much more reliable)
clickhouse-client --query "INSERT INTO opinion_clusters FORMAT JSONEachRow" < opinion-clusters.ndjson
```

### ❌ Option 4: Direct Import (Current - FAILS)

```sql
INSERT INTO opinion_clusters
SELECT * FROM file('opinion-clusters.csv.bz2', CSV)
-- FAILS after 10,000 rows with parse errors
```

## Recommended Path Forward

**Use the existing `build-index.ts` as a template** to create a proper CSV → ClickHouse preprocessor:

1. Parse PostgreSQL CSV with Node.js (handles quoting correctly)
2. Clean/normalize fields (strip HTML, handle nulls)
3. Output as NDJSON or TSV (simpler formats)
4. Import to ClickHouse

## Temporary Workaround

For testing the SDK tools without real data:

```typescript
// Create sample data programmatically
import {getClickHouseClient} from './clickhouse/client'

const client = getClickHouseClient()

// Create table
await client.command({ query: OPINION_CLUSTER_SCHEMA })

// Insert sample rows
await client.insert({
  table: 'opinion_clusters',
  values: [
    {
      id: 1,
      case_name: 'Brown v. Board of Education',
      case_name_short: 'Brown v. Board',
      date_filed: '1954-05-17',
      judges: 'Warren',
      // ... other fields
    },
    // ... more sample cases
  ],
  format: 'JSONEachRow'
})
```

## Next Steps

1. Create `preprocess-csv.ts` to handle PostgreSQL CSV correctly
2. Convert CSV → NDJSON with proper parsing
3. Import NDJSON to ClickHouse (reliable)
4. Or just use sample data for SDK testing

The SDK implementation is complete and tested - we just need properly formatted data!
