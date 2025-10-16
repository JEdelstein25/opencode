# ClickHouse SDK Migration Plan

Detailed plan for rewriting the ClickHouse indexer using the official `@clickhouse/client` SDK.

## Current Implementation (CLI-based)

**Problems:**
- ❌ Spawns new process per operation (overhead)
- ❌ No connection pooling
- ❌ Fragile progress tracking (parsing stderr)
- ❌ No streaming support
- ❌ Complex error handling

**What works:**
- ✅ Schema definitions (preserve these!)
- ✅ Compression detection
- ✅ Data source abstraction
- ✅ Progress callback interface

---

## New Architecture (SDK-based)

### 1. Core Components

```
clickhouse/
├── client.ts           - SDK client singleton & configuration
├── schemas.ts          - Table schemas (PRESERVE)
├── indexer.ts          - Import/indexing logic (REWRITE)
├── query.ts            - Query utilities (NEW)
├── search-tools.ts     - 4 LLM search tools (NEW)
└── types.ts            - TypeScript interfaces (NEW)
```

---

## Detailed Implementation Plan

### Phase 1: Client Setup (`client.ts`)

**Purpose:** Singleton ClickHouse client with connection pooling

```typescript
import { createClient, type ClickHouseClient } from '@clickhouse/client'

let clientInstance: ClickHouseClient | null = null

export interface ClickHouseConfig {
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
}

export function getClickHouseClient(config?: ClickHouseConfig): ClickHouseClient {
  if (!clientInstance) {
    clientInstance = createClient({
      url: `http://${config?.host || 'localhost'}:${config?.port || 8123}`,
      username: config?.username || 'default',
      password: config?.password || '',
      database: config?.database || 'default',
      
      // Connection pooling
      max_open_connections: 10,
      request_timeout: 300000,  // 5 min for large imports
      
      // Keep-alive
      keep_alive: {
        enabled: true,
        idle_socket_ttl: 2500
      },
      
      // Compression
      compression: {
        request: true,
        response: true
      }
    })
  }
  
  return clientInstance
}

export async function closeClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.close()
    clientInstance = null
  }
}

export async function checkClickHouseConnection(): Promise<boolean> {
  try {
    const client = getClickHouseClient()
    const result = await client.query({
      query: 'SELECT 1',
      format: 'JSONEachRow'
    })
    await result.json()
    return true
  } catch {
    return false
  }
}
```

**Key features:**
- ✅ Singleton pattern (reuse connections)
- ✅ Auto-compression
- ✅ Long timeout for bulk imports
- ✅ Connection health check

---

### Phase 2: Import Rewrite (`indexer.ts`)

**Preserve from v1:**
- `DataSource` interface
- `ImportOptions` interface
- `ImportProgress` interface
- `CompressionFormat` type
- Progress callback every 5 seconds

**New implementation:**

```typescript
import { getClickHouseClient } from './client'
import { type DataSource, type ImportOptions, type ImportProgress } from './types'

export async function importToClickHouse(options: ImportOptions): Promise<ImportResult> {
  const { tableName, source, createTableSQL, settings, onProgress } = options
  const client = getClickHouseClient(options.clickhouseConfig)
  const startTime = Date.now()
  
  onProgress?.({ status: 'starting', message: `Preparing import to ${tableName}` })
  
  try {
    // 1. Create table if schema provided
    if (createTableSQL) {
      await client.command({
        query: createTableSQL,
        clickhouse_settings: {
          wait_end_of_query: 1
        }
      })
    }
    
    // 2. Build INSERT query
    const insertQuery = buildInsertQuery(tableName, source)
    
    // 3. Execute with streaming progress tracking
    const rowsImported = await executeInsertWithProgress(
      client,
      insertQuery,
      source,
      settings,
      onProgress
    )
    
    const duration = (Date.now() - startTime) / 1000
    onProgress?.({
      status: 'completed',
      rowsInserted: rowsImported,
      elapsedSeconds: duration
    })
    
    return { success: true, rowsImported, durationSeconds: duration, tableName }
  } catch (error) {
    return handleImportError(error, startTime, tableName, onProgress)
  }
}

function buildInsertQuery(table: string, source: DataSource): string {
  const compressionSuffix = source.compression !== 'none' ? ` COMPRESSION '${source.compression}'` : ''
  
  if (source.type === 'local') {
    return `INSERT INTO ${table} SELECT * FROM file('${source.path}', CSVWithNames)${compressionSuffix}`
  } else {
    // S3 source
    return `INSERT INTO ${table} SELECT * FROM s3('${source.path}', CSVWithNames)${compressionSuffix}`
  }
}

async function executeInsertWithProgress(
  client: ClickHouseClient,
  query: string,
  source: DataSource,
  settings: Record<string, any>,
  onProgress?: (p: ImportProgress) => void
): Promise<number> {
  const startTime = Date.now()
  let lastProgressUpdate = Date.now()
  
  // Set up progress polling (every 5 seconds)
  const progressInterval = setInterval(async () => {
    const elapsed = (Date.now() - startTime) / 1000
    
    // Query system.processes for current insert progress
    const stats = await getInsertProgress(client, query)
    
    onProgress?.({
      status: 'importing',
      rowsInserted: stats.rows_read || 0,
      bytesProcessed: stats.bytes_read || 0,
      elapsedSeconds: elapsed,
      message: `Importing... ${stats.rows_read?.toLocaleString() || 0} rows`
    })
  }, 5000)
  
  try {
    // Execute INSERT
    const result = await client.command({
      query,
      clickhouse_settings: {
        max_insert_threads: settings.max_insert_threads || 4,
        max_insert_block_size: settings.max_insert_block_size || 1048576,
        ...settings
      }
    })
    
    clearInterval(progressInterval)
    
    // Get final row count
    const countResult = await client.query({
      query: `SELECT count() as cnt FROM ${query.match(/INSERT INTO (\S+)/)?.[1]}`,
      format: 'JSONEachRow'
    })
    const countData = await countResult.json<{ cnt: string }>()
    
    return parseInt(countData[0]?.cnt || '0', 10)
  } finally {
    clearInterval(progressInterval)
  }
}

async function getInsertProgress(client: ClickHouseClient, queryPattern: string) {
  try {
    const result = await client.query({
      query: `
        SELECT 
          read_rows as rows_read,
          read_bytes as bytes_read
        FROM system.processes 
        WHERE query LIKE '%${queryPattern.substring(0, 50)}%'
        LIMIT 1
        FORMAT JSONEachRow
      `,
      format: 'JSONEachRow'
    })
    const data = await result.json<{ rows_read: number; bytes_read: number }>()
    return data[0] || { rows_read: 0, bytes_read: 0 }
  } catch {
    return { rows_read: 0, bytes_read: 0 }
  }
}
```

**Key improvements:**
- ✅ Real progress tracking via `system.processes`
- ✅ SDK handles compression automatically
- ✅ Better error handling with `ClickHouseError`
- ✅ Connection reuse

---

### Phase 3: Query Utilities (`query.ts`)

**Purpose:** Helper functions for common ClickHouse queries

```typescript
import { getClickHouseClient } from './client'

export async function queryJSON<T>(
  query: string,
  params?: Record<string, any>
): Promise<T[]> {
  const client = getClickHouseClient()
  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow'
  })
  return result.json<T>()
}

export async function queryStream<T>(
  query: string,
  onChunk: (rows: T[]) => void,
  params?: Record<string, any>
): Promise<void> {
  const client = getClickHouseClient()
  const result = await client.query({
    query,
    query_params: params,
    format: 'JSONEachRow'
  })
  
  const stream = result.stream()
  for await (const rows of stream) {
    const jsonRows = rows.map(row => row.json() as T)
    onChunk(jsonRows)
  }
}

export async function executeCommand(query: string): Promise<void> {
  const client = getClickHouseClient()
  await client.command({
    query,
    clickhouse_settings: { wait_end_of_query: 1 }
  })
}

export async function tableExists(tableName: string): Promise<boolean> {
  const result = await queryJSON<{ count: string }>(
    `SELECT count() as count FROM system.tables WHERE name = {table:String}`,
    { table: tableName }
  )
  return parseInt(result[0]?.count || '0', 10) > 0
}

export async function getRowCount(tableName: string): Promise<number> {
  const result = await queryJSON<{ cnt: string }>(
    `SELECT count() as cnt FROM ${tableName}`
  )
  return parseInt(result[0]?.cnt || '0', 10)
}
```

**Benefits:**
- ✅ Type-safe query helpers
- ✅ Streaming support for large results
- ✅ Reusable utilities

---

### Phase 4: Search Tools (`search-tools.ts`)

**Four tools for LLM agents:**

```typescript
import z from 'zod'
import { Tool } from '../../src/tool/tool'
import { queryJSON, queryStream } from './query'
import { fetchOpinionFromCache, searchOpinionContent } from '../opinion-cache'

// ====================
// GLOBAL FILTER STATE
// ====================

interface SearchFilters {
  states?: string[]          // e.g., ['CA', 'NY', 'AZ']
  dateRange?: [string, string]  // e.g., ['2020-01-01', '2024-12-31']
  courts?: string[]          // e.g., ['scotus', 'ca9', 'cacd']
  precedentialOnly?: boolean // Only published/precedential opinions
}

let globalFilters: SearchFilters = {}

// ====================
// TOOL 1: Configure Filters
// ====================

export const ConfigureSearchFilters = Tool.define('courtlistener_configure_filters', {
  description: `Configure global search filters for CourtListener queries.
  
These filters apply to all subsequent metadata and keyword searches until changed.

Filters:
- states: US state codes (CA, NY, TX, etc.) - searches state courts
- dateRange: Date range for opinions [start, end] in YYYY-MM-DD
- courts: Specific court IDs (scotus, ca9, nysd, etc.)
- precedentialOnly: Only show published/precedential opinions

Examples:
- California cases: states=['CA']
- Recent cases: dateRange=['2020-01-01', '2024-12-31']
- Supreme Court only: courts=['scotus']
- Clear filters: states=[], dateRange=undefined`,

  parameters: z.object({
    states: z.array(z.string()).optional().describe('US state codes (e.g., ["CA", "NY", "AZ"])'),
    dateRange: z.tuple([z.string(), z.string()]).optional().describe('Date range [start, end]'),
    courts: z.array(z.string()).optional().describe('Court IDs (e.g., ["scotus", "ca9"])'),
    precedentialOnly: z.boolean().optional().describe('Only published opinions')
  }),

  async execute(params, ctx) {
    // Update global filters
    if (params.states !== undefined) globalFilters.states = params.states.length > 0 ? params.states : undefined
    if (params.dateRange !== undefined) globalFilters.dateRange = params.dateRange
    if (params.courts !== undefined) globalFilters.courts = params.courts.length > 0 ? params.courts : undefined
    if (params.precedentialOnly !== undefined) globalFilters.precedentialOnly = params.precedentialOnly

    const active = []
    if (globalFilters.states) active.push(`States: ${globalFilters.states.join(', ')}`)
    if (globalFilters.dateRange) active.push(`Dates: ${globalFilters.dateRange[0]} to ${globalFilters.dateRange[1]}`)
    if (globalFilters.courts) active.push(`Courts: ${globalFilters.courts.join(', ')}`)
    if (globalFilters.precedentialOnly) active.push('Precedential only: Yes')

    const output = active.length > 0
      ? `Active filters:\n${active.map(f => `  • ${f}`).join('\n')}`
      : 'All filters cleared'

    return {
      title: 'Filters updated',
      output,
      metadata: { filters: globalFilters }
    }
  }
})

// ====================
// TOOL 2: Metadata Search
// ====================

export const SearchByMetadata = Tool.define('courtlistener_search_metadata', {
  description: `Fast metadata search using ClickHouse indexes (milliseconds).
  
Searches indexed columns only: case_name, court, date_filed, precedential_status.
Uses global filters configured with courtlistener_configure_filters.

Returns cluster IDs for use with keyword search tool.

Examples:
- "California DUI cases": caseNameKeywords=['DUI', 'driving', 'intoxicated']
- "Recent Supreme Court": courts=['scotus'] via configure_filters + no keywords
- "Deportation cases": caseNameKeywords=['deportation', 'removal', 'immigration']`,

  parameters: z.object({
    caseNameKeywords: z.array(z.string()).optional().describe('Keywords to find in case_name'),
    limit: z.number().optional().describe('Max results (default: 1000)')
  }),

  async execute(params, ctx) {
    const keywords = params.caseNameKeywords || []
    const limit = params.limit || 1000

    // Build WHERE clause with global filters
    const conditions: string[] = []
    
    if (globalFilters.states && globalFilters.states.length > 0) {
      const statePattern = globalFilters.states.map(s => `%${s}%`).join('|')
      conditions.push(`court_id LIKE ANY(['%${globalFilters.states.join("%','%")}%'])`)
    }
    
    if (globalFilters.dateRange) {
      conditions.push(`date_filed BETWEEN '${globalFilters.dateRange[0]}' AND '${globalFilters.dateRange[1]}'`)
    }
    
    if (globalFilters.courts && globalFilters.courts.length > 0) {
      conditions.push(`court_id IN (${globalFilters.courts.map(c => `'${c}'`).join(',')})`)
    }
    
    if (globalFilters.precedentialOnly) {
      conditions.push(`precedential_status IN ('Published', 'Precedential')`)
    }
    
    // Add case name keywords
    for (const keyword of keywords) {
      conditions.push(`case_name LIKE '%${keyword}%'`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    
    const query = `
      SELECT 
        id as cluster_id,
        case_name,
        case_name_short,
        court_id,
        date_filed,
        precedential_status,
        citation_count
      FROM opinion_clusters
      ${whereClause}
      ORDER BY date_filed DESC
      LIMIT ${limit}
      FORMAT JSONEachRow
    `

    const results = await queryJSON<{
      cluster_id: number
      case_name: string
      case_name_short: string
      court_id: string
      date_filed: string
      precedential_status: string
      citation_count: number
    }>(query)

    const output = results.length === 0
      ? 'No matching cases found'
      : `Found ${results.length} matching cases:\n\n` +
        results.slice(0, 20).map(r => 
          `[${r.cluster_id}] ${r.case_name_short}\n` +
          `  Court: ${r.court_id} | Date: ${r.date_filed} | Citations: ${r.citation_count}`
        ).join('\n\n') +
        (results.length > 20 ? `\n\n... and ${results.length - 20} more` : '')

    return {
      title: `${results.length} cases found`,
      output,
      metadata: {
        count: results.length,
        clusterIds: results.map(r => r.cluster_id),
        results
      }
    }
  }
})

// ====================
// TOOL 3: Keyword Search
// ====================

export const SearchByKeywords = Tool.define('courtlistener_search_keywords', {
  description: `Full-text keyword search using ClickHouse trigram indexes (5-30 seconds).
  
Searches the plain_text field of opinions using indexed LIKE queries.
Requires cluster IDs from courtlistener_search_metadata tool.

Returns opinion IDs and text snippets for use with regex search tool.

Examples:
- keywords=['habeas', 'corpus']
- keywords=['qualified', 'immunity']
- keywords=['deportation', 'relief', 'granted']`,

  parameters: z.object({
    clusterIds: z.array(z.number()).describe('Cluster IDs from metadata search'),
    keywords: z.array(z.string()).describe('Keywords to search in opinion text'),
    limit: z.number().optional().describe('Max opinions to return (default: 100)')
  }),

  async execute(params, ctx) {
    const { clusterIds, keywords, limit = 100 } = params

    if (clusterIds.length === 0) {
      return {
        title: 'No clusters provided',
        output: 'Provide cluster IDs from courtlistener_search_metadata first',
        metadata: { opinionIds: [] }
      }
    }

    // Build keyword search with LIKE (uses ngrambf_v1 index)
    const keywordConditions = keywords.map(k => `plain_text LIKE '%${k}%'`)
    
    const query = `
      SELECT 
        id as opinion_id,
        cluster_id,
        type,
        author_str,
        substring(plain_text, 1, 300) as snippet
      FROM opinions
      WHERE cluster_id IN (${clusterIds.join(',')})
        AND (${keywordConditions.join(' AND ')})
      ORDER BY cluster_id, id
      LIMIT ${limit}
      FORMAT JSONEachRow
    `

    const results = await queryJSON<{
      opinion_id: number
      cluster_id: number
      type: string
      author_str: string
      snippet: string
    }>(query)

    const output = results.length === 0
      ? `No opinions found with keywords: ${keywords.join(', ')}`
      : `Found ${results.length} opinions:\n\n` +
        results.slice(0, 15).map(r =>
          `Opinion ${r.opinion_id} (Cluster ${r.cluster_id})\n` +
          `  Type: ${r.type} | Author: ${r.author_str || 'Per Curiam'}\n` +
          `  Snippet: ${r.snippet.substring(0, 150)}...`
        ).join('\n\n') +
        (results.length > 15 ? `\n\n... and ${results.length - 15} more` : '')

    return {
      title: `${results.length} opinions found`,
      output: output + '\n\nUse courtlistener_regex_search to search these opinions with patterns.',
      metadata: {
        count: results.length,
        opinionIds: results.map(r => r.opinion_id),
        results
      }
    }
  }
})

// ====================
// TOOL 4: Regex Search
// ====================

export const RegexSearch = Tool.define('courtlistener_regex_search', {
  description: `Precise regex search using ripgrep on cached opinion text (sub-second).
  
Downloads and caches opinions from keyword search, then runs ripgrep with full regex support.
Provides exact matches with line numbers and context.

Regex patterns use Rust regex syntax (similar to PCRE).

Examples:
- pattern='\\b(habeas|mandamus)\\s+corpus\\b'
- pattern='\\d{2}-\\d{4}' (case numbers)
- pattern='(?i)relief.*granted' (case-insensitive)`,

  parameters: z.object({
    opinionIds: z.array(z.number()).describe('Opinion IDs from keyword search'),
    pattern: z.string().describe('Regex pattern (Rust regex syntax)'),
    contextLines: z.number().optional().describe('Lines of context (default: 3)')
  }),

  async execute(params, ctx) {
    const { opinionIds, pattern, contextLines = 3 } = params

    if (opinionIds.length === 0) {
      return {
        title: 'No opinions provided',
        output: 'Provide opinion IDs from courtlistener_search_keywords first',
        metadata: { matches: [] }
      }
    }

    // Fetch opinions to cache (parallel)
    const cachePromises = opinionIds.map(id => 
      fetchOpinionFromCache(id, ctx.abort)
    )
    await Promise.all(cachePromises)

    // Run ripgrep on cached files
    const matches = await searchOpinionContent(
      opinionIds,
      pattern,
      { contextLines, maxMatches: 50, signal: ctx.abort }
    )

    if (matches.length === 0) {
      return {
        title: 'No matches found',
        output: `Pattern '${pattern}' found 0 matches in ${opinionIds.length} opinions`,
        metadata: { matches: [] }
      }
    }

    const output = `Found ${matches.length} matches:\n\n` +
      matches.slice(0, 10).map(m =>
        `Opinion ${m.opinionId} (Line ${m.lineNumber}):\n` +
        `  ${m.matchText}\n`
      ).join('\n') +
      (matches.length > 10 ? `\n... and ${matches.length - 10} more matches` : '')

    return {
      title: `${matches.length} regex matches`,
      output: output + '\n\nUse courtlistener_read to get full opinion text.',
      metadata: {
        count: matches.length,
        matches,
        opinionIds: [...new Set(matches.map(m => m.opinionId))]
      }
    }
  }
})
```

---

## Preserved Schemas

**File:** `schemas.ts` - **NO CHANGES NEEDED**

These remain intact:
- ✅ `OPINION_CLUSTER_SCHEMA`
- ✅ `OPINION_SCHEMA`
- ✅ `DOCKET_SCHEMA`
- ✅ `getSchemaForDataset()`
- ✅ `SCHEMA_OPTIMIZATIONS`
- ✅ All compression/partitioning strategies

**Why:** Schema definitions are database-agnostic. Moving from CLI to SDK doesn't affect table structure.

---

## Migration Checklist

### Dependencies
```bash
npm install @clickhouse/client
```

### File Changes

- [ ] **NEW:** `client.ts` - SDK client singleton
- [ ] **REWRITE:** `indexer.ts` - Use SDK instead of spawn()
- [ ] **NEW:** `query.ts` - Query helper utilities
- [ ] **NEW:** `search-tools.ts` - 4 LLM tools
- [ ] **NEW:** `types.ts` - TypeScript interfaces
- [ ] **PRESERVE:** `schemas.ts` - No changes
- [ ] **UPDATE:** Tests for new SDK implementation

### Testing Strategy

```bash
# 1. Test client connection
bun test client.test.ts

# 2. Test import with small file
bun run import-clickhouse /tmp/small-test.csv.bz2

# 3. Test each search tool
bun test search-tools.test.ts

# 4. Integration test: Full search funnel
bun test integration.test.ts
```

---

## Expected Performance Improvements

| Operation | CLI (v1) | SDK (v2) | Improvement |
|-----------|----------|----------|-------------|
| Connection overhead | ~100ms per query | ~1ms (pooled) | **100x** |
| Progress tracking | Parse stderr | Query system.processes | More reliable |
| Memory usage | Spawn overhead | Streaming | 50-80% less |
| Error messages | String parsing | Structured errors | Better DX |
| Type safety | None | Full TypeScript | Fewer bugs |

---

## Search Flow Example

```typescript
// 1. Configure filters
await ConfigureSearchFilters.execute({
  states: ['CA'],
  dateRange: ['2020-01-01', '2024-12-31']
})
// Active filters: California, 2020-2024

// 2. Metadata search
const metaResults = await SearchByMetadata.execute({
  caseNameKeywords: ['DUI', 'moped']
})
// → 1,245 clusters (milliseconds)

// 3. Keyword search
const keywordResults = await SearchByKeywords.execute({
  clusterIds: metaResults.metadata.clusterIds,
  keywords: ['moped', 'motorized', 'bicycle', 'DUI']
})
// → 47 opinions (5-10 seconds)

// 4. Regex search
const regexResults = await RegexSearch.execute({
  opinionIds: keywordResults.metadata.opinionIds,
  pattern: '\\b(moped|motorized.{0,20}bicycle)\\b.*\\bDUI\\b'
})
// → 8 precise matches (<1 second)

// Total: ~10-15 seconds, 10M opinions → 8 results
```

---

## Breaking Changes

### v1 (CLI) → v2 (SDK)

**Function signatures stay same:**
```typescript
// Still works!
await importToClickHouse({
  tableName: 'opinions',
  source: { type: 'local', path: '/tmp/file.bz2', compression: 'bz2' },
  onProgress: (stats) => console.log(stats)
})
```

**Internal changes:**
- `spawn('clickhouse-client')` → `client.command()`
- stderr parsing → `system.processes` queries
- String error handling → `ClickHouseError` types

**No API changes needed!**

---

## Implementation Priority

### Phase 1 (Essential)
1. ✅ `client.ts` - SDK setup
2. ✅ `query.ts` - Helper functions
3. ✅ Rewrite `importToClickHouse()` in `indexer.ts`

### Phase 2 (Search Tools)
4. ✅ `search-tools.ts` - 4 tools
5. ✅ Integration with existing `opinion-cache.ts`

### Phase 3 (Polish)
6. ✅ Update all tests
7. ✅ Add integration tests
8. ✅ Update documentation

---

## Rollout Strategy

### Option A: Clean Break
- Delete old `clickhouse-indexer.ts`
- Replace with SDK version
- Update imports

### Option B: Side-by-Side
- Keep `clickhouse-indexer.ts` (legacy)
- Create `clickhouse-indexer-v2.ts` (SDK)
- Gradual migration

**Recommendation:** Option A (clean break)
- Current implementation not in production
- SDK is strictly better
- No reason to maintain two versions

---

## Dependencies Required

```json
{
  "dependencies": {
    "@clickhouse/client": "^1.12.1"
  }
}
```

**Size:** ~500KB (reasonable for the functionality)

**TypeScript:** Built-in type definitions included

---

## Next Steps

1. Install `@clickhouse/client`
2. Implement `client.ts` singleton
3. Implement `query.ts` helpers
4. Rewrite `indexer.ts` import logic
5. Implement 4 search tools in `search-tools.ts`
6. Write tests
7. Update documentation

**Estimated effort:** 2-4 hours for full SDK migration + search tools
