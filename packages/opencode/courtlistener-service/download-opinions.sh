#!/bin/bash
# Download the opinions bulk data file

set -e

OPINIONS_URL="https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/opinions-2025-10-09.csv.bz2"
OUTPUT_DIR="/tmp/cache/tier1"
OUTPUT_FILE="$OUTPUT_DIR/opinions-2025-10-09.csv.bz2"

echo "📥 Downloading CourtListener opinions bulk data..."
echo "   URL: $OPINIONS_URL"
echo "   Size: 53.6 GB (compressed)"
echo "   Estimated time: 1-2 hours on fast connection"
echo ""

mkdir -p "$OUTPUT_DIR"

# Use curl with resume support
curl -C - -L "$OPINIONS_URL" -o "$OUTPUT_FILE" \
  --progress-bar \
  | cat

echo ""
echo "✅ Download complete!"
echo "   File: $OUTPUT_FILE"
ls -lh "$OUTPUT_FILE"
