#!/usr/bin/env bun
/**
 * CLI tool to import CourtListener bulk data into ClickHouse
 *
 * Usage:
 *   bun run import-to-clickhouse.ts /path/to/file.csv.bz2
 *   bun run import-to-clickhouse.ts --s3 s3://bucket/file.csv.bz2
 */

/* eslint-disable no-console */

import {
	checkClickHouseAvailable,
	detectCompressionFormat,
	formatBytes,
	getFileSize,
	importToClickHouse,
	type DataSource,
	type ImportProgress,
} from './clickhouse-indexer'
import { getSchemaForDataset } from './schemas'

async function main() {
	const args = process.argv.slice(2)

	if (args.length === 0) {
		console.error('Usage: bun run import-to-clickhouse.ts <file-path>')
		console.error('       bun run import-to-clickhouse.ts --s3 <s3-url>')
		console.error('')
		console.error('Examples:')
		console.error('  bun run import-to-clickhouse.ts /tmp/opinion-clusters.csv.bz2')
		console.error(
			'  bun run import-to-clickhouse.ts --s3 https://storage.courtlistener.com/bulk-data/opinions.csv.bz2',
		)
		process.exit(1)
	}

	// Check if ClickHouse is available
	console.log('Checking for ClickHouse client...')
	const available = await checkClickHouseAvailable()
	if (!available) {
		console.error('❌ ClickHouse client not found. Please install clickhouse-client first.')
		console.error('')
		console.error('Installation:')
		console.error('  macOS: brew install clickhouse')
		console.error('  Linux: https://clickhouse.com/docs/en/install')
		process.exit(1)
	}
	console.log('✓ ClickHouse client available\n')

	// Parse arguments
	const isS3 = args[0] === '--s3'
	const filePath = isS3 ? args[1] : args[0]

	if (!filePath) {
		console.error('Error: No file path provided')
		process.exit(1)
	}

	// Detect compression and dataset type
	const compression = detectCompressionFormat(filePath)
	const filename = filePath.split('/').pop() || 'unknown'
	
	// Extract base dataset name (without date suffix)
	const baseDatasetName = filename
		.replace(/\.csv\.(bz2|gz|xz|zst|zstd)$/, '')
		.replace(/-\d{4}-\d{2}-\d{2}$/, '')
	
	const tableName = filename.replace(/\.csv\.(bz2|gz|xz|zst|zstd)$/, '').replace(/-/g, '_')

	console.log('Import Configuration:')
	console.log(`  Source:      ${isS3 ? 'S3' : 'Local'}`)
	console.log(`  File:        ${filename}`)
	console.log(`  Dataset:     ${baseDatasetName}`)
	console.log(`  Compression: ${compression}`)
	console.log(`  Table:       ${tableName}`)

	if (!isS3) {
		const fileSize = getFileSize(filePath)
		console.log(`  Size:        ${formatBytes(fileSize)}`)
	}

	// Get optimized schema if available
	const optimizedSchema = getSchemaForDataset(baseDatasetName)
	if (optimizedSchema) {
		console.log(`  Schema:      Optimized (with compression, partitioning)`)
	} else {
		console.log(`  Schema:      Auto-inferred (fallback)`)
	}

	console.log('')

	// Create data source
	const source: DataSource = {
		type: isS3 ? 's3' : 'local',
		path: filePath,
		compression,
	}

	// Use optimized schema if available, otherwise fall back to auto-inference
	const createTableSQL = optimizedSchema || `
		CREATE TABLE IF NOT EXISTS ${tableName}
		ENGINE = MergeTree()
		ORDER BY tuple()
		AS SELECT * FROM ${source.type === 'local' ? 'file' : 's3'}('${filePath}', CSVWithNames, '${compression}')
		LIMIT 0
	`

	// Progress tracking
	let lastStatus = ''
	const onProgress = (stats: ImportProgress) => {
		const statusLine = stats.message || `${stats.status}...`
		if (statusLine !== lastStatus) {
			console.log(`[${new Date().toISOString()}] ${statusLine}`)
			lastStatus = statusLine
		}
	}

	// Execute import
	console.log('Starting import...\n')
	const result = await importToClickHouse({
		tableName,
		source,
		createTableSQL,
		settings: {
			max_insert_threads: 4,
			max_insert_block_size: 1048576,
		},
		onProgress,
	})

	console.log('')
	if (result.success) {
		console.log('✓ Import completed successfully!')
		console.log(`  Rows imported: ${result.rowsImported.toLocaleString()}`)
		console.log(`  Duration: ${result.durationSeconds.toFixed(1)}s`)
		console.log(
			`  Rate: ${(result.rowsImported / result.durationSeconds).toFixed(0)} rows/sec`,
		)
	} else {
		console.error('❌ Import failed!')
		console.error(`  Error: ${result.error}`)
		process.exit(1)
	}
}

main().catch((error) => {
	console.error('Fatal error:', error)
	process.exit(1)
})
