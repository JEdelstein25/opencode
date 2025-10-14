/**
 * Download bulk data from CourtListener's S3 bucket.
 *
 * CourtListener stores bulk data in a public S3 bucket that can be accessed
 * without AWS credentials using anonymous access.
 *
 * Bucket: s3://com-courtlistener-storage/bulk-data/
 * HTTP: https://storage.courtlistener.com/bulk-data/
 */

/* eslint-disable no-console */

import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const STORAGE_BASE_URL = 'https://storage.courtlistener.com'

/**
 * List available bulk data files in the S3 bucket.
 *
 * @example
 * const files = await listBulkDataFiles()
 * console.log(files)
 * // ['opinion-clusters-2024-01-31.csv.bz2', 'opinions-2024-01-31.csv.bz2', ...]
 */
export async function listBulkDataFiles(): Promise<string[]> {
	// The S3 bucket uses a static HTML listing page
	// We need to scrape it or use the S3 ListObjects API
	const response = await fetch(`${STORAGE_BASE_URL}/?prefix=bulk-data/`)

	if (!response.ok) {
		throw new Error(`Failed to list bulk data: ${response.status}`)
	}

	const html = await response.text()

	// Parse HTML to extract file links
	const fileRegex = /bulk-data\/([^"<]+\.csv\.bz2)/g
	const files: string[] = []
	let match: RegExpExecArray | null

	while ((match = fileRegex.exec(html)) !== null) {
		if (match[1]) {
			files.push(match[1])
		}
	}

	return files
}

/**
 * Download a bulk data file from CourtListener's S3 bucket.
 *
 * @param filename - Filename in the bulk-data/ prefix (e.g., 'opinion-clusters-2024-01-31.csv.bz2')
 * @param outputPath - Where to save the downloaded file
 *
 * @example
 * await downloadBulkDataFile(
 *   'opinion-clusters-2024-01-31.csv.bz2',
 *   '/tmp/opinion-clusters.csv.bz2'
 * )
 */
export async function downloadBulkDataFile(
	filename: string,
	outputPath: string,
	options?: {
		signal?: AbortSignal
		onProgress?: (bytesDownloaded: number) => void
	},
): Promise<void> {
	const url = `${STORAGE_BASE_URL}/bulk-data/${filename}`

	console.log(`Downloading ${url}...`)

	const response = await fetch(url, { signal: options?.signal })

	if (!response.ok) {
		throw new Error(`Failed to download ${filename}: ${response.status} ${response.statusText}`)
	}

	if (!response.body) {
		throw new Error('No response body')
	}

	const totalSize = parseInt(response.headers.get('content-length') || '0', 10)
	console.log(`File size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)

	// Convert web stream to Node stream
	const nodeStream = Readable.fromWeb(response.body as any)

	// Track progress if callback provided
	let downloaded = 0
	if (options?.onProgress) {
		nodeStream.on('data', (chunk) => {
			downloaded += chunk.length
			options.onProgress!(downloaded)
		})
	}

	// Write to file
	await pipeline(nodeStream, createWriteStream(outputPath))

	console.log(`Downloaded to ${outputPath}`)
}

/**
 * Get the latest bulk data filename for a given table.
 *
 * @example
 * const latest = await getLatestBulkDataFile('opinion-clusters')
 * // Returns: 'opinion-clusters-2024-01-31.csv.bz2'
 */
export async function getLatestBulkDataFile(tableName: string): Promise<string | null> {
	const files = await listBulkDataFiles()

	// Filter to this table and sort by date (newest first)
	const tableFiles = files
		.filter((f) => f.startsWith(`${tableName}-`))
		.sort()
		.reverse()

	return tableFiles[0] || null
}
