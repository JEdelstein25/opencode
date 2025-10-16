#!/usr/bin/env bun
/**
 * CLI tool to import CourtListener bulk data into ClickHouse using SDK
 * 
 * Usage:
 *   bun cli-import.ts /path/to/opinions.csv.bz2
 *   bun cli-import.ts s3://bucket/opinions.csv.bz2 --dataset opinions
 */

import { importToClickHouse } from './indexer'
import { getSchemaForDataset } from './schemas'
import type { CompressionFormat } from './types'

async function main() {
	const args = process.argv.slice(2)
	
	if (args.length === 0 || args.includes('--help')) {
		console.log(`
Usage: bun cli-import.ts <file-path> [options]

Arguments:
  <file-path>        Path to CSV file (local or s3://)

Options:
  --dataset <name>   Dataset name (opinions, clusters, dockets)
  --table <name>     Custom table name
  --host <host>      ClickHouse host (default: localhost)
  --port <port>      ClickHouse port (default: 8123)
  --database <db>    Database name (default: default)
  --no-schema        Skip table creation
  
Examples:
  bun cli-import.ts /tmp/opinions.csv.bz2 --dataset opinions
  bun cli-import.ts s3://bucket/data.csv.gz --dataset clusters --host clickhouse.example.com
		`)
		process.exit(0)
	}

	const filePath = args[0]!
	const dataset = getArg(args, '--dataset') || detectDatasetFromPath(filePath)
	const tableName = getArg(args, '--table') || dataset
	const createSchema = !args.includes('--no-schema')
	
	const clickhouseConfig = {
		host: getArg(args, '--host') || 'localhost',
		port: parseInt(getArg(args, '--port') || '8123', 10),
		database: getArg(args, '--database') || 'default',
	}

	// Detect compression
	const compression = detectCompression(filePath)
	
	// Get schema
	const createTableSQL = createSchema ? getSchemaForDataset(dataset) : null

	console.log(`
📊 ClickHouse Import Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
File:        ${filePath}
Dataset:     ${dataset}
Table:       ${tableName}
Compression: ${compression}
Host:        ${clickhouseConfig.host}:${clickhouseConfig.port}
Database:    ${clickhouseConfig.database}
Schema:      ${createSchema ? '✓ Create table' : '✗ Skip creation'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	`)

	const result = await importToClickHouse({
		tableName,
		source: {
			type: filePath.startsWith('s3://') ? 's3' : 'local',
			path: filePath,
			compression,
		},
		createTableSQL: createTableSQL ?? undefined,
		clickhouseConfig,
		onProgress: (progress) => {
			if (progress.status === 'importing') {
				const rows = (progress.rowsInserted || 0).toLocaleString()
				const bytes = formatBytes(progress.bytesProcessed || 0)
				const time = progress.elapsedSeconds?.toFixed(1) || '0.0'
				process.stdout.write(`\r⏳ Importing... ${rows} rows, ${bytes} (${time}s)`)
			} else if (progress.status === 'completed') {
				console.log(`\n✅ ${progress.message}`)
			} else if (progress.status === 'failed') {
				console.log(`\n❌ ${progress.message}`)
			} else {
				console.log(`ℹ️  ${progress.message}`)
			}
		},
	})

	if (!result.success) {
		console.error(`\n❌ Import failed: ${result.error}`)
		process.exit(1)
	}

	console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Import completed successfully!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Rows:     ${result.rowsImported?.toLocaleString()}
Duration: ${result.durationSeconds?.toFixed(2)}s
Table:    ${result.tableName}
	`)
}

function getArg(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag)
	return index !== -1 && index + 1 < args.length ? args[index + 1] : undefined
}

function detectCompression(path: string): CompressionFormat {
	if (path.endsWith('.bz2')) return 'bz2'
	if (path.endsWith('.gz')) return 'gzip'
	if (path.endsWith('.xz')) return 'xz'
	if (path.endsWith('.zst')) return 'zstd'
	return 'none'
}

function detectDatasetFromPath(path: string): string {
	const lower = path.toLowerCase()
	if (lower.includes('opinion-cluster')) return 'opinion_clusters'
	if (lower.includes('opinion') && !lower.includes('cluster')) return 'opinions'
	if (lower.includes('docket')) return 'dockets'
	return 'unknown'
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

main().catch((err) => {
	console.error('Fatal error:', err)
	process.exit(1)
})
