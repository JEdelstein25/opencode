# ClickHouse + CourtListener Quick Start

Step-by-step guide to get ClickHouse running and load CourtListener data.

## Step 1: Start ClickHouse Server

### Option A: Foreground (recommended for testing)

```bash
/opt/homebrew/bin/clickhouse server
```

Keep this terminal open. You should see:
```
<Information> Application: Starting ClickHouse...
<Information> Application: Ready for connections
```

### Option B: Background

```bash
/opt/homebrew/bin/clickhouse server --daemon
```

### Verify It's Running

```bash
curl http://localhost:8123/ping
# Should return: Ok
```

## Step 2: Load CourtListener Data

Open a **new terminal** and run:

```bash
cd packages/opencode/courtlistener-service

# Load sample data (opinion-clusters only, ~8M rows, 5-15 min)
bun clickhouse/load-sample-data.ts
```

You'll see:
```
🔍 Checking ClickHouse connection...
✅ ClickHouse connected

📥 Finding latest opinion-clusters bulk data...
Found: opinion-clusters-2025-10-09.csv.bz2

📥 Downloading opinion-clusters-2025-10-09.csv.bz2...
Downloaded 100 MB...
Downloaded 200 MB...
...
✅ Download complete!

📊 Importing to ClickHouse...
⏳ Importing... 1,234,567 rows, 500 MB (45.2s)
✅ Import completed: 8,724,567 rows in 312.45s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Sample data loaded successfully!
Table:    opinion_clusters
Rows:     8,724,567
Duration: 312.45s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Step 3: Test the Search Tools

```bash
# Test metadata search
bun -e "
import {courtlistenerSearchMetadata} from './clickhouse/search-tools'
const result = await courtlistenerSearchMetadata.execute(
  {caseNameKeywords: ['Brown', 'Board']},
  {sessionID: 'test-123'}
)
console.log(result.output)
"
```

Expected output:
```
Found 47 cases:

• Brown v. Board of Education (1954-05-17)
• Board of Education v. Brown (1955-03-12)
...

Cached cluster IDs for keyword search.
```

## Step 4: Load Full Dataset (Optional)

For full-text keyword search, also load the opinions table:

```bash
# Download opinions (WARNING: ~10GB compressed, ~50GB uncompressed)
bash download-opinions.sh

# Import to ClickHouse (may take 1-2 hours)
bun clickhouse/cli-import.ts /tmp/courtlistener-data/opinions-*.csv.bz2 --dataset opinions
```

## Troubleshooting

### ClickHouse won't start

```bash
# Check if port 8123 is already in use
lsof -i :8123

# Kill existing process
pkill -f clickhouse

# Try starting again
/opt/homebrew/bin/clickhouse server
```

### Connection refused

```bash
# Check if server is running
curl http://localhost:8123/ping

# Check logs
tail -f /opt/homebrew/var/log/clickhouse-server/clickhouse-server.log
```

### Import fails

```bash
# Check ClickHouse is running
curl http://localhost:8123/?query=SELECT%201

# Test client connection
bun -e "import {checkClickHouseConnection} from './clickhouse/client'; console.log(await checkClickHouseConnection())"
# Should print: true
```

### Download fails

```bash
# Download manually
wget https://storage.courtlistener.com/bulk-data/opinion-clusters-2025-10-09.csv.bz2 \
  -O /tmp/courtlistener-data/opinion-clusters-2025-10-09.csv.bz2

# Then import
bun clickhouse/cli-import.ts /tmp/courtlistener-data/opinion-clusters-*.csv.bz2 --dataset opinion_clusters
```

## Quick Commands Reference

```bash
# Start ClickHouse
/opt/homebrew/bin/clickhouse server

# Stop ClickHouse
pkill -f clickhouse-server

# Test connection
curl http://localhost:8123/ping

# Load sample data
bun clickhouse/load-sample-data.ts

# Manual import
bun clickhouse/cli-import.ts /path/to/file.csv.bz2 --dataset opinion_clusters

# Test search
bun -e "import {courtlistenerSearchMetadata} from './clickhouse/search-tools'; console.log(await courtlistenerSearchMetadata.execute({caseNameKeywords:['Brown']}, {sessionID:'test'}))"
```

## What Gets Loaded

### Sample Data (Quick)
- **Dataset**: opinion_clusters only
- **Size**: ~2GB compressed, ~8M rows
- **Time**: 5-15 minutes
- **Features**: Metadata search only

### Full Data (Complete)
- **Datasets**: opinion_clusters + opinions
- **Size**: ~12GB compressed, ~15M rows
- **Time**: 1-2 hours
- **Features**: All 4 search tools (metadata, keywords, regex)

## Next Steps After Loading

Once data is loaded, you can:

1. **Test all 4 search tools** (see README.md)
2. **Run integration tests** with real data
3. **Benchmark performance** on your hardware
4. **Start building features** that use CourtListener search!
