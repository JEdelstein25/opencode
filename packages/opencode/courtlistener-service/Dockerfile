# CourtListener Search Service
FROM oven/bun:1

# Install ripgrep, ripgrep-all and dependencies
RUN apt-get update && apt-get install -y \
    curl \
    bzip2 \
    zstd \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Install ripgrep-all
RUN curl -L https://github.com/phiresky/ripgrep-all/releases/download/v0.10.6/ripgrep_all-v0.10.6-x86_64-unknown-linux-musl.tar.gz \
    | tar xz -C /usr/local/bin --strip-components=1

# Create cache directories
RUN mkdir -p /cache/tier1 /cache/tier2/opinions

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Expose API port
EXPOSE 3000

# Environment variables
ENV COURTLISTENER_INDEX_PATH=/cache/tier1/case_index.ndjson
ENV COURTLISTENER_CACHE_DIR=/cache/tier2/opinions
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["bun", "run", "server.ts"]
