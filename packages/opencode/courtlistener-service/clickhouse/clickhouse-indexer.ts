/**
 * ClickHouse indexer for processing and importing compressed bulk data.
 *
 * Supports importing compressed files into ClickHouse with progress tracking.
 * Can handle both local files and remote S3 sources.
 */

/* eslint-disable no-console */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'

export type CompressionFormat = 'bz2' | 'gz' | 'xz' | 'zstd' | 'none'

export interface DataSource {
	type: 'local' | 's3'
	path: string
	compression: CompressionFormat
}

export interface ImportOptions {
	tableName: string
	source: DataSource
	clickhouseHost?: string
	clickhousePort?: number
	clickhouseDatabase?: string
	/**
	 * SQL for creating the target table (optional).
	 * If not provided, schema will be auto-inferred.
	 */
	createTableSQL?: string
	/**
	 * Additional ClickHouse settings for import
	 */
	settings?: Record<string, string | number>
	/**
	 * Progress callback - called at least every 5 seconds during import
	 */
	onProgress?: (stats: ImportProgress) => void
}

export interface ImportProgress {
	status: 'starting' | 'importing' | 'completed' | 'failed'
	rowsInserted?: number
	bytesProcessed?: number
	elapsedSeconds?: number
	message?: string
}

export interface ImportResult {
	success: boolean
	rowsImported: number
	durationSeconds: number
	tableName: string
	error?: string
}

/**
 * Import a compressed CSV file into ClickHouse.
 *
 * @example
 * const result = await importToClickHouse({
 *   tableName: 'opinion_clusters',
 *   source: {
 *     type: 'local',
 *     path: '/tmp/opinion-clusters.csv.bz2',
 *     compression: 'bz2'
 *   },
 *   onProgress: (stats) => {
 *     console.log(`Status: ${stats.status}, Rows: ${stats.rowsInserted}`)
 *   }
 * })
 */
export async function importToClickHouse(options: ImportOptions): Promise<ImportResult> {
	const startTime = Date.now()
	const {
		tableName,
		source,
		clickhouseHost = 'localhost',
		clickhousePort = 9000,
		clickhouseDatabase = 'default',
		createTableSQL,
		settings = {},
		onProgress,
	} = options

	// Validate source
	if (source.type === 'local') {
		if (!existsSync(source.path)) {
			throw new Error(`Local file not found: ${source.path}`)
		}
	}

	// Notify start
	onProgress?.({
		status: 'starting',
		message: `Preparing to import ${basename(source.path)} into ${tableName}`,
	})

	try {
		// Create table if SQL provided
		if (createTableSQL) {
			await executeClickHouseQuery(createTableSQL, {
				host: clickhouseHost,
				port: clickhousePort,
				database: clickhouseDatabase,
			})
			console.log(`✓ Created table: ${tableName}`)
		}

		// Build the import query based on source type
		const importSQL = buildImportSQL(tableName, source, settings)

		// Execute import with progress tracking
		const rowsImported = await executeImportWithProgress(
			importSQL,
			{
				host: clickhouseHost,
				port: clickhousePort,
				database: clickhouseDatabase,
			},
			onProgress,
		)

		const durationSeconds = (Date.now() - startTime) / 1000

		onProgress?.({
			status: 'completed',
			rowsInserted: rowsImported,
			elapsedSeconds: durationSeconds,
			message: `Import completed: ${rowsImported} rows in ${durationSeconds.toFixed(1)}s`,
		})

		return {
			success: true,
			rowsImported,
			durationSeconds,
			tableName,
		}
	} catch (error) {
		const durationSeconds = (Date.now() - startTime) / 1000
		const errorMessage = error instanceof Error ? error.message : String(error)

		onProgress?.({
			status: 'failed',
			elapsedSeconds: durationSeconds,
			message: `Import failed: ${errorMessage}`,
		})

		return {
			success: false,
			rowsImported: 0,
			durationSeconds,
			tableName,
			error: errorMessage,
		}
	}
}

/**
 * Build the ClickHouse INSERT query for importing data
 */
function buildImportSQL(
	tableName: string,
	source: DataSource,
	settings: Record<string, string | number>,
): string {
	let sql = `INSERT INTO ${tableName} SELECT * FROM `

	if (source.type === 'local') {
		// Use file() table function for local files
		const compressionParam = source.compression !== 'none' ? `, '${source.compression}'` : ''
		sql += `file('${source.path}', CSVWithNames${compressionParam})`
	} else {
		// Use s3() table function for S3 sources
		const compressionParam = source.compression !== 'none' ? `, '${source.compression}'` : ''
		sql += `s3('${source.path}', CSVWithNames${compressionParam})`
	}

	// Add settings if provided
	if (Object.keys(settings).length > 0) {
		sql += ' SETTINGS '
		sql += Object.entries(settings)
			.map(([key, value]) => `${key}=${value}`)
			.join(', ')
	}

	return sql
}

/**
 * Execute a ClickHouse query without expecting results
 */
async function executeClickHouseQuery(
	query: string,
	config: { host: string; port: number; database: string },
): Promise<void> {
	return new Promise((resolve, reject) => {
		const args = [
			'--host',
			config.host,
			'--port',
			String(config.port),
			'--database',
			config.database,
			'--query',
			query,
		]

		const process = spawn('clickhouse-client', args)

		let stderr = ''

		process.stderr.on('data', (data) => {
			stderr += data.toString()
		})

		process.on('close', (code) => {
			if (code === 0) {
				resolve()
			} else {
				reject(new Error(`ClickHouse query failed: ${stderr}`))
			}
		})

		process.on('error', (error) => {
			reject(new Error(`Failed to spawn clickhouse-client: ${error.message}`))
		})
	})
}

/**
 * Execute import query with progress tracking (logs every 5 seconds)
 */
async function executeImportWithProgress(
	query: string,
	config: { host: string; port: number; database: string },
	onProgress?: (stats: ImportProgress) => void,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const startTime = Date.now()

		const args = [
			'--host',
			config.host,
			'--port',
			String(config.port),
			'--database',
			config.database,
			'--query',
			query,
			'--progress', // Enable progress reporting
			'--format',
			'JSON',
		]

		const process = spawn('clickhouse-client', args)

		let stdout = ''
		let stderr = ''
		let lastProgressUpdate = Date.now()
		let rowsInserted = 0

		// Set up progress reporting interval (every 5 seconds)
		const progressInterval = setInterval(() => {
			const elapsedSeconds = (Date.now() - startTime) / 1000
			onProgress?.({
				status: 'importing',
				rowsInserted,
				elapsedSeconds,
				message: `Importing... ${rowsInserted} rows (${elapsedSeconds.toFixed(1)}s elapsed)`,
			})
		}, 5000)

		process.stdout.on('data', (data) => {
			stdout += data.toString()

			// Try to parse progress from output
			const progressMatch = /(\d+)\s+rows/.exec(data.toString())
			if (progressMatch && progressMatch[1]) {
				rowsInserted = parseInt(progressMatch[1], 10)

				// Update progress if 5+ seconds since last update
				const now = Date.now()
				if (now - lastProgressUpdate >= 5000) {
					const elapsedSeconds = (now - startTime) / 1000
					onProgress?.({
						status: 'importing',
						rowsInserted,
						elapsedSeconds,
						message: `Importing... ${rowsInserted} rows (${elapsedSeconds.toFixed(1)}s)`,
					})
					lastProgressUpdate = now
				}
			}
		})

		process.stderr.on('data', (data) => {
			stderr += data.toString()
			// ClickHouse often outputs progress to stderr
			const progressMatch = /(\d+)\s+rows/.exec(data.toString())
			if (progressMatch && progressMatch[1]) {
				rowsInserted = parseInt(progressMatch[1], 10)
			}
		})

		process.on('close', (code) => {
			clearInterval(progressInterval)

			if (code === 0) {
				// Try to extract final row count from output
				const finalMatch = /(\d+)\s+rows/.exec(stdout + stderr)
				if (finalMatch && finalMatch[1]) {
					rowsInserted = parseInt(finalMatch[1], 10)
				}
				resolve(rowsInserted)
			} else {
				reject(new Error(`ClickHouse import failed (exit code ${code}): ${stderr}`))
			}
		})

		process.on('error', (error) => {
			clearInterval(progressInterval)
			reject(new Error(`Failed to spawn clickhouse-client: ${error.message}`))
		})
	})
}

/**
 * Check if ClickHouse client is available
 */
export async function checkClickHouseAvailable(): Promise<boolean> {
	try {
		await new Promise<void>((resolve, reject) => {
			const process = spawn('clickhouse-client', ['--version'])
			process.on('close', (code) => {
				if (code === 0) resolve()
				else reject(new Error('clickhouse-client not available'))
			})
			process.on('error', reject)
		})
		return true
	} catch {
		return false
	}
}

/**
 * Detect compression format from file extension
 */
export function detectCompressionFormat(filename: string): CompressionFormat {
	const ext = filename.toLowerCase()
	if (ext.endsWith('.bz2')) return 'bz2'
	if (ext.endsWith('.gz')) return 'gz'
	if (ext.endsWith('.xz')) return 'xz'
	if (ext.endsWith('.zst') || ext.endsWith('.zstd')) return 'zstd'
	return 'none'
}

/**
 * Get file size in bytes (for local files only)
 */
export function getFileSize(path: string): number {
	if (!existsSync(path)) {
		throw new Error(`File not found: ${path}`)
	}
	return statSync(path).size
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
