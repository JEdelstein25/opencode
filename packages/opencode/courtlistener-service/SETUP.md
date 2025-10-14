# CourtListener Service Setup Guide

This guide explains how to get the CourtListener service running with data.

## Quick Start (Without Data)

The service will start and run health checks without data, but searches won't work:

```bash
cd packages/opencode/courtlistener-service
bun install
bun run dev
```

Test it:
```bash
curl http://localhost:3000/health
# {"status":"healthy"}
```

## Full Setup (With Data)

To actually search cases, you need to build the case index first.

### Option 1: Build the Index (Recommended for Development)

The case index is built from CourtListener's public bulk data exports.

**Prerequisites:**
- `bunzip2` command (usually pre-installed on macOS/Linux)
- ~2GB disk space for download
- ~500MB for final index

**Steps:**

1. **Copy the build script from amp-cl-agent:**
```bash
# From the amp-cl-agent repo
cp core/src/external-services/courtlistener/build-index.ts \
   core/src/external-services/courtlistener/download-bulk-data.ts \
   ~/path/to/opencode/packages/opencode/courtlistener-service/
```

2. **Run the build script:**
```bash
cd packages/opencode/courtlistener-service
bun run build-index.ts
```

This will:
- Download the latest opinion-clusters CSV from CourtListener (~500MB-2GB compressed)
- Decompress and parse the PostgreSQL CSV export
- Create an NDJSON index file (~500MB)
- Save to `/tmp/cache/tier1/case_index.ndjson`

**Progress output:**
```
Building CourtListener case index...
Finding latest bulk data from CourtListener...
Latest file: opinion-clusters-2024-12-01.csv.bz2
Downloaded 10 MB...
Downloaded 20 MB...
...
Processed 100000 lines, 95234 entries...
Processed 200000 lines, 189456 entries...
...
Total: 8724567 cases indexed
Writing to /tmp/cache/tier1/case_index.ndjson
Index build complete!
```

3. **Start the service:**
```bash
bun run dev
```

4. **Test with a search:**
```bash
curl -X POST http://localhost:3000/search/cases \
  -H "Content-Type: application/json" \
  -d '{"pattern": "*Brown*Board*", "limit": 5}'
```

### Option 2: Use Pre-built Index

If someone has already built the index, you can use it directly:

```bash
# Copy from another location
cp /path/to/case_index.ndjson /tmp/cache/tier1/

# Or mount it in docker-compose.yml
volumes:
  - /path/to/case_index.ndjson:/cache/tier1/case_index.ndjson:ro
```

### Option 3: Use Docker Compose

The easiest way for production:

```bash
# Build and start
docker compose up -d

# Copy index into container
docker cp /path/to/case_index.ndjson \
  courtlistener-search:/cache/tier1/case_index.ndjson

# Or rebuild the index inside the container
docker exec -it courtlistener-search bun run build-index.ts
```

## Data Architecture

### Tier 1: Case Index (500MB)
- **Format:** NDJSON (one JSON object per line)
- **Contains:** Case IDs, names, courts, dates
- **Location:** `/tmp/cache/tier1/case_index.ndjson`
- **Updated:** Monthly (rebuild required)
- **Source:** CourtListener bulk data exports

**Example entry:**
```json
{"id":12345,"name":"Brown v. Board","full_name":"Brown v. Board of Education","court":"Supreme Court","court_id":"scotus","date":"1954-05-17","citation":"347 U.S. 483"}
```

### Tier 2: Opinion Cache (10GB LRU)
- **Format:** Individual JSON files per opinion
- **Contains:** Full opinion text, metadata, citations
- **Location:** `/tmp/cache/tier2/opinions/`
- **Updated:** On-demand (fetched from CourtListener API)
- **Eviction:** Automatic LRU when > 10GB

**Example structure:**
```
/tmp/cache/tier2/opinions/
├── 12345.json    # Full opinion JSON
├── 12345.txt     # Searchable text for ripgrep-all
├── 67890.json
├── 67890.txt
└── ...
```

## Troubleshooting

### Service starts but searches fail

**Problem:** No case index found
```
Error: ENOENT: no such file or directory, open '/tmp/cache/tier1/case_index.ndjson'
```

**Solution:** Build the index (see Option 1 above)

### Build script fails

**Problem:** `bunzip2: command not found`

**Solution:**
```bash
# macOS
brew install bzip2

# Ubuntu/Debian
sudo apt-get install bzip2

# Alpine
apk add bzip2
```

**Problem:** Download times out

**Solution:** CourtListener's bulk data can be large. Be patient or:
- Use a faster internet connection
- Download manually from https://www.courtlistener.com/bulk-data/
- Extract and place in `/tmp/cache/tier1/`

### Opinion fetches fail

**Problem:** Rate limit exceeded (429 error)

**Solution:** CourtListener API has 1000 requests/hour limit. Wait or:
- Use cached opinions (Tier 2)
- Implement request queuing
- Sign up for higher limits (if available)

### ripgrep-all not found

**Problem:** Content search fails

**Solution:**
```bash
# macOS
brew install ripgrep-all

# Linux
cargo install ripgrep-all

# Or download binary from GitHub
```

## Data Updates

The case index should be rebuilt monthly to get new cases:

```bash
# Backup old index
mv /tmp/cache/tier1/case_index.ndjson \
   /tmp/cache/tier1/case_index.ndjson.backup

# Build new index
cd packages/opencode/courtlistener-service
bun run build-index.ts

# Restart service
docker compose restart
```

## Storage Requirements

- **Tier 1 index:** ~500 MB (one-time)
- **Tier 2 cache:** up to 10 GB (grows on-demand)
- **Build artifacts:** ~2 GB temporary (during index build)
- **Total:** ~12.5 GB maximum

## Performance Notes

- **Cold start:** 2-5s to load index into memory
- **Case search:** 50-200ms (in-memory glob matching)
- **Opinion fetch (cached):** 10-50ms
- **Opinion fetch (uncached):** 3-5s (API fetch + cache write)
- **Content search:** 100-500ms (ripgrep-all on cached text)

## Next Steps

Once the service is running with data:

1. Test the API endpoints (see README.md)
2. Configure opencode tools to use `COURTLISTENER_SERVICE_URL=http://localhost:3000`
3. Try searching: `courtlistener_search pattern="*qualified immunity*"`
