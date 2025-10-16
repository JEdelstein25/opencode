/**
 * ClickHouse indexer using official SDK (@clickhouse/client)
 * Replaces spawn-based CLI approach with streaming SDK methods
 */

import { getClickHouseClient } from './client'
import { getInsertProgress, getTableRowCount } from './query'
import type { ImportOptions, ImportProgress, ImportResult } from './types'

export async function importToClickHouse(options: ImportOptions): Promise<ImportResult> {
	const { tableName, source, createTableSQL, settings, onProgress, clickhouseConfig } = options
	const client = getClickHouseClient(clickhouseConfig)
	const startTime = Date.now()

	onProgress?.({ status: 'starting', message: `Preparing import to ${tableName}` })

	try {
		// 1. Create table if schema provided
		if (createTableSQL) {
			await client.command({
				query: createTableSQL,
				clickhouse_settings: {
					wait_end_of_query: 1,
				},
			})
			onProgress?.({ status: 'starting', message: `Table ${tableName} created` })
		}

		// 2. Build INSERT query
		const insertQuery = buildInsertQuery(tableName, source)
		onProgress?.({ status: 'starting', message: 'Starting data import...' })

		// 3. Execute with streaming progress tracking
		const rowsImported = await executeInsertWithProgress(client, insertQuery, tableName, settings || {}, onProgress)

		const duration = (Date.now() - startTime) / 1000
		onProgress?.({
			status: 'completed',
			rowsInserted: rowsImported,
			elapsedSeconds: duration,
			message: `Import completed: ${rowsImported.toLocaleString()} rows in ${duration.toFixed(2)}s`,
		})

		return {
			success: true,
			rowsImported,
			durationSeconds: duration,
			tableName,
		}
	} catch (error) {
		return handleImportError(error, startTime, tableName, onProgress)
	}
}

function buildInsertQuery(table: string, source: { type: 'local' | 's3'; path: string; compression: string }): string {
	const compressionSuffix = source.compression !== 'none' ? ` COMPRESSION '${source.compression}'` : ''

	if (source.type === 'local') {
		return `INSERT INTO ${table} SELECT * FROM file('${source.path}', CSVWithNames)${compressionSuffix}`
	}

	// S3 source
	return `INSERT INTO ${table} SELECT * FROM s3('${source.path}', CSVWithNames)${compressionSuffix}`
}

async function executeInsertWithProgress(
	client: any,
	query: string,
	tableName: string,
	settings: Record<string, any>,
	onProgress?: (p: ImportProgress) => void,
): Promise<number> {
	const startTime = Date.now()
	let progressInterval: NodeJS.Timeout | null = null

	// Set up progress polling (every 5 seconds)
	if (onProgress) {
		progressInterval = setInterval(async () => {
			const elapsed = (Date.now() - startTime) / 1000
			const stats = await getInsertProgress(client, query)

			onProgress({
				status: 'importing',
				rowsInserted: stats.read_rows || 0,
				bytesProcessed: stats.read_bytes || 0,
				elapsedSeconds: elapsed,
				message: `Importing... ${(stats.read_rows || 0).toLocaleString()} rows`,
			})
		}, 5000)
	}

	try {
		// Execute INSERT
		await client.command({
			query,
			clickhouse_settings: {
				max_insert_threads: settings.max_insert_threads || 4,
				max_insert_block_size: settings.max_insert_block_size || 1048576,
				...settings,
			},
		})

		if (progressInterval) clearInterval(progressInterval)

		// Get final row count
		const rowCount = await getTableRowCount(client, tableName)
		return rowCount
	} finally {
		if (progressInterval) clearInterval(progressInterval)
	}
}

function handleImportError(
	error: unknown,
	startTime: number,
	tableName: string,
	onProgress?: (p: ImportProgress) => void,
): ImportResult {
	const duration = (Date.now() - startTime) / 1000
	const errorMsg = error instanceof Error ? error.message : String(error)

	onProgress?.({
		status: 'failed',
		elapsedSeconds: duration,
		message: `Import failed: ${errorMsg}`,
	})

	return {
		success: false,
		durationSeconds: duration,
		tableName,
		error: errorMsg,
	}
}
