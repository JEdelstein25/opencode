# CourtListener Search Service

Docker-based HTTP service for searching and retrieving legal opinions from CourtListener.

## Features

- **Two-tier caching system**
  - Tier 1: 500MB case name index (in-memory glob search)
  - Tier 2: 10GB LRU opinion cache (full-text search with ripgrep-all)
- **REST API** for case search and opinion retrieval
- **Automatic cache management** with LRU eviction
- **Health checks** and graceful shutdown

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Build and start the service
docker compose up -d

# View logs
docker compose logs -f

# Stop the service
docker compose down
```

### Development (Local)

```bash
# Install dependencies
bun install

# Start the server
bun run dev
```

## API Endpoints

### Health Check
```bash
GET /health
```

### Get Opinion by ID
```bash
GET /api/opinions/:id

# Example
curl http://localhost:3000/api/opinions/12345
```

### Search Cases
```bash
POST /search/cases
Content-Type: application/json

{
  "pattern": "*Brown*Board*",
  "court": ["scotus"],
  "dateRange": ["2020-01-01", "2024-12-31"],
  "limit": 50
}
```

### Search Content
```bash
POST /search/content
Content-Type: application/json

{
  "caseIds": [12345, 67890],
  "query": "qualified immunity",
  "contextLines": 3,
  "maxMatches": 20
}
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `COURTLISTENER_INDEX_PATH` - Path to case index (default: `/tmp/cache/tier1/case_index.ndjson`)
- `COURTLISTENER_CACHE_DIR` - Path to opinion cache (default: `/tmp/cache/tier2/opinions`)
- `NODE_ENV` - Environment (default: `production`)

## Building the Index

Before using the service, you need to build the case index:

```bash
# Download and build the index (from amp-cl-agent repo)
cd amp-cl-agent/core/src/external-services/courtlistener
bun run build-index.ts

# Copy the index to the cache directory
mkdir -p /tmp/cache/tier1
cp case_index.ndjson /tmp/cache/tier1/
```

Or mount it as a volume in docker-compose.yml:
```yaml
volumes:
  - /path/to/case_index.ndjson:/cache/tier1/case_index.ndjson:ro
```

## Architecture

```
Client (opencode tools)
    ↓
HTTP Server (port 3000)
    ↓
┌─────────────────────────────┐
│  Tier 1: Case Index (500MB) │
│  - In-memory glob search     │
│  - Fast pattern matching     │
└─────────────────────────────┘
    ↓
┌─────────────────────────────┐
│  Tier 2: Opinion Cache (10GB)│
│  - LRU cache                 │
│  - ripgrep-all search        │
│  - Auto eviction             │
└─────────────────────────────┘
    ↓
CourtListener API (fallback)
```

## Dependencies

- **Bun** - JavaScript runtime
- **ripgrep-all** - Full-text search tool
- **picomatch** - Glob pattern matching
- **CourtListener API** - Legal opinion data source

## Cache Management

- **Tier 1**: Loaded once on startup, kept in memory
- **Tier 2**: 
  - Max size: 10 GB
  - Target size after eviction: 9 GB
  - LRU eviction policy
  - Automatic cleanup

## Health & Monitoring

The service includes:
- Health check endpoint (`/health`)
- Docker health checks every 30s
- Graceful shutdown on SIGTERM
- Request error logging

## Integration with Opencode

The opencode tool plugins communicate with this service:

```typescript
// In opencode/packages/opencode/src/tool/courtlistener-*.ts
const SERVICE_URL = process.env.COURTLISTENER_SERVICE_URL || "http://localhost:3000"
```

Set `COURTLISTENER_SERVICE_URL` to point to your Docker service.

## Troubleshooting

**Service won't start:**
- Check if port 3000 is available
- Verify ripgrep-all is installed: `docker exec <container> which rga`
- Check cache directory permissions

**No results from search:**
- Verify case index exists at `/cache/tier1/case_index.ndjson`
- Check logs: `docker compose logs -f`
- Test health endpoint: `curl http://localhost:3000/health`

**Slow searches:**
- Case index not loaded (check logs for "Cache metadata loaded")
- Tier 2 cache is cold (first requests will be slower)
- Rate limit hit on CourtListener API (check response headers)

## Development

```bash
# Start in dev mode with auto-reload
bun run dev

# Build Docker image
docker compose build

# Run tests (if added)
bun test
```

## License

Part of the opencode project.
