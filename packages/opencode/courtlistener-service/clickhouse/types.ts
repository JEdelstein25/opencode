/**
 * TypeScript interfaces for ClickHouse SDK implementation
 */

export interface ClickHouseConfig {
	host?: string
	port?: number
	database?: string
	username?: string
	password?: string
}

export type CompressionFormat = 'none' | 'gzip' | 'bz2' | 'xz' | 'zstd'

export interface DataSource {
	type: 'local' | 's3'
	path: string
	compression: CompressionFormat
}

export interface ImportProgress {
	status: 'starting' | 'importing' | 'completed' | 'failed'
	rowsInserted?: number
	bytesProcessed?: number
	elapsedSeconds?: number
	message?: string
}

export interface ImportOptions {
	tableName: string
	source: DataSource
	createTableSQL?: string
	settings?: Record<string, any>
	clickhouseConfig?: ClickHouseConfig
	onProgress?: (progress: ImportProgress) => void
}

export interface ImportResult {
	success: boolean
	rowsImported?: number
	durationSeconds?: number
	tableName?: string
	error?: string
}

export interface SearchFilters {
	states?: string[]
	courts?: string[]
	dateRange?: [string, string]
	precedentialStatus?: string[]
}
