#!/bin/bash
# Demo script for CourtListener service

set -e

echo "🔧 Setting up demo..."

# Create cache directories
mkdir -p /tmp/cache/tier1 /tmp/cache/tier2/opinions

# Create a small test index with famous cases
cat > /tmp/cache/tier1/case_index.ndjson << 'EOF'
{"id":108713,"name":"Brown v. Board of Education","full_name":"Brown v. Board of Education of Topeka","court":"Supreme Court","court_id":"scotus","date":"1954-05-17","citation":"347 U.S. 483"}
{"id":112175,"name":"Roe v. Wade","full_name":"Roe v. Wade","court":"Supreme Court","court_id":"scotus","date":"1973-01-22","citation":"410 U.S. 113"}
{"id":2825899,"name":"United States v. Nixon","full_name":"United States v. Richard M. Nixon","court":"Supreme Court","court_id":"scotus","date":"1974-07-24","citation":"418 U.S. 683"}
{"id":2801513,"name":"Miranda v. Arizona","full_name":"Miranda v. Arizona","court":"Supreme Court","court_id":"scotus","date":"1966-06-13","citation":"384 U.S. 436"}
{"id":106903,"name":"Marbury v. Madison","full_name":"Marbury v. Madison","court":"Supreme Court","court_id":"scotus","date":"1803-02-24","citation":"5 U.S. 137"}
EOF

echo "✅ Created test case index with 5 famous Supreme Court cases"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    bun install
fi

# Start the server in background
echo "🚀 Starting CourtListener service..."
bun run server.ts > /tmp/cl-demo.log 2>&1 &
SERVER_PID=$!

# Wait for server to start
sleep 2

# Check if server is running
if ! curl -s http://localhost:3000/health > /dev/null; then
    echo "❌ Server failed to start. Check /tmp/cl-demo.log"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi

echo "✅ Server is running on http://localhost:3000"
echo ""

# Demo 1: Health check
echo "📍 Demo 1: Health Check"
echo "------------------------"
curl -s http://localhost:3000/health | jq .
echo ""

# Demo 2: Search for Brown
echo "📍 Demo 2: Search for 'Brown' cases"
echo "----------------------------------------"
curl -s -X POST http://localhost:3000/search/cases \
  -H "Content-Type: application/json" \
  -d '{"pattern": "*Brown*", "limit": 10}' | jq '.cases[] | {name, date, citation}'
echo ""

# Demo 3: Search for all Supreme Court cases
echo "📍 Demo 3: All Supreme Court cases"
echo "---------------------------------------"
curl -s -X POST http://localhost:3000/search/cases \
  -H "Content-Type: application/json" \
  -d '{"pattern": "*", "court": ["scotus"], "limit": 10}' | jq '.cases | length as $count | "Found \($count) cases"'
echo ""

# Demo 4: Search with date range
echo "📍 Demo 4: Cases from 1960-1980"
echo "------------------------------------"
curl -s -X POST http://localhost:3000/search/cases \
  -H "Content-Type: application/json" \
  -d '{"pattern": "*", "dateRange": ["1960-01-01", "1980-12-31"], "limit": 10}' | jq '.cases[] | {name, date}'
echo ""

# Demo 5: Try to fetch an opinion (will fail without real data, but shows the endpoint)
echo "📍 Demo 5: Fetch opinion by ID (will fail - no real data)"
echo "---------------------------------------------------------------"
curl -s http://localhost:3000/api/opinions/108713 | head -c 200
echo ""
echo ""

echo "🎉 Demo complete!"
echo ""
echo "To stop the server:"
echo "  kill $SERVER_PID"
echo ""
echo "Server logs:"
echo "  tail -f /tmp/cl-demo.log"
echo ""
echo "Next steps:"
echo "  1. Build the full case index (see SETUP.md)"
echo "  2. Test with opencode tools"
echo "  3. Deploy with Docker Compose"

# Keep server running
echo ""
echo "Press Ctrl+C to stop the server..."
wait $SERVER_PID
