#!/usr/bin/env bun
/**
 * Example: Import CourtListener data to ClickHouse
 *
 * This example shows how to use the clickhouse-indexer module
 * to import compressed CSV files into ClickHouse with progress tracking.
 */

/* eslint-disable no-console */

import {
	checkClickHouseAvailable,
	detectCompressionFormat,
	formatBytes,
	getFileSize,
	importToClickHouse,
	type ImportProgress,
} from './clickhouse-indexer'

async function example() {
	console.log('=== ClickHouse Import Example ===\n')

	// 1. Check if ClickHouse is available
	console.log('Step 1: Checking ClickHouse availability...')
	const available = await checkClickHouseAvailable()
	if (!available) {
		console.error('❌ ClickHouse client not found')
		console.error('Install with: brew install clickhouse')
		return
	}
	console.log('✓ ClickHouse client is available\n')

	// 2. Configure the import
	const filePath = '/tmp/opinion-clusters.csv.bz2'
	const compression = detectCompressionFormat(filePath)
	const tableName = 'opinion_clusters_example'

	console.log('Step 2: Import Configuration')
	console.log(`  File: ${filePath}`)
	console.log(`  Compression: ${compression}`)
	console.log(`  Table: ${tableName}`)

	try {
		const size = getFileSize(filePath)
		console.log(`  Size: ${formatBytes(size)}`)
	} catch (error) {
		console.log(`  Note: File not found locally (will need to download)`)
		console.log(`  You can download it with:`)
		console.log(
			`    wget https://storage.courtlistener.com/bulk-data/opinion-clusters-2025-10-09.csv.bz2 -O ${filePath}`,
		)
		return
	}

	console.log('')

	// 3. Define table schema (optional but recommended for production)
	const createTableSQL = `
		CREATE TABLE IF NOT EXISTS ${tableName} (
			id UInt64,
			date_created DateTime,
			date_modified DateTime,
			judges String,
			precedential_status LowCardinality(String),
			citation_count UInt32,
			case_name String,
			slug String,
			federal_cite_one String,
			state_cite_one String,
			neutral_cite String
		)
		ENGINE = MergeTree()
		ORDER BY (date_created, id)
	`

	// 4. Set up progress tracking
	console.log('Step 3: Starting import with progress tracking...\n')

	const progressCallback = (stats: ImportProgress) => {
		const timestamp = new Date().toISOString().substring(11, 19)
		const rows = stats.rowsInserted?.toLocaleString() || '0'
		const elapsed = stats.elapsedSeconds?.toFixed(1) || '0.0'

		switch (stats.status) {
			case 'starting':
				console.log(`[${timestamp}] 🚀 ${stats.message}`)
				break
			case 'importing':
				console.log(`[${timestamp}] ⏳ Importing... ${rows} rows (${elapsed}s elapsed)`)
				break
			case 'completed':
				console.log(`[${timestamp}] ✓ ${stats.message}`)
				break
			case 'failed':
				console.log(`[${timestamp}] ❌ ${stats.message}`)
				break
		}
	}

	// 5. Execute the import
	const result = await importToClickHouse({
		tableName,
		source: {
			type: 'local',
			path: filePath,
			compression: 'bz2',
		},
		createTableSQL,
		settings: {
			max_insert_threads: 4,
			max_insert_block_size: 1048576,
		},
		onProgress: progressCallback,
	})

	// 6. Display results
	console.log('\n=== Import Results ===')
	if (result.success) {
		console.log(`✓ Success!`)
		console.log(`  Rows imported: ${result.rowsImported.toLocaleString()}`)
		console.log(`  Duration: ${result.durationSeconds.toFixed(2)}s`)
		console.log(
			`  Rate: ${Math.round(result.rowsImported / result.durationSeconds).toLocaleString()} rows/sec`,
		)
		console.log(`\nYou can now query the data with:`)
		console.log(`  clickhouse-client --query "SELECT count() FROM ${tableName}"`)
		console.log(
			`  clickhouse-client --query "SELECT * FROM ${tableName} LIMIT 5 FORMAT Pretty"`,
		)
	} else {
		console.log(`❌ Failed: ${result.error}`)
	}
}

// Run the example
example().catch((error) => {
	console.error('Error:', error.message)
	process.exit(1)
})
