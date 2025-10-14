/**
 * Script to build the case name index from CourtListener bulk data.
 *
 * This downloads the latest bulk data exports and creates a searchable NDJSON index.
 *
 * Usage:
 *   pnpm tsx core/src/external-services/courtlistener/build-index.ts
 */

/* eslint-disable no-console */

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import * as readline from 'node:readline'

import { downloadBulkDataFile, getLatestBulkDataFile } from './download-bulk-data'
import type { CaseIndexEntry } from './types'

const OUTPUT_DIR = process.env.COURTLISTENER_INDEX_PATH || '/tmp/cache/tier1'
const OUTPUT_FILE = `${OUTPUT_DIR}/case_index.ndjson`

/**
 * Build the case index from CourtListener bulk data.
 *
 * Data sources:
 * - opinion-clusters CSV: Contains case names, court, date
 * - opinions CSV: Contains opinion metadata
 * - courts CSV: Contains court names/IDs
 *
 * The resulting index is an NDJSON file where each line is a CaseIndexEntry.
 */
async function buildCaseIndex(): Promise<void> {
	console.log('Building CourtListener case index...')

	await mkdir(OUTPUT_DIR, { recursive: true })

	// Step 1: Download latest bulk data
	console.log('Finding latest bulk data from CourtListener...')

	const clustersFilename = await getLatestBulkDataFile('opinion-clusters')
	if (!clustersFilename) {
		throw new Error('No opinion-clusters bulk data found')
	}

	console.log(`Latest file: ${clustersFilename}`)

	// Download to temp location
	const tempFile = `${OUTPUT_DIR}/${clustersFilename}`
	await downloadBulkDataFile(clustersFilename, tempFile, {
		onProgress: (bytes) => {
			if (bytes % (10 * 1024 * 1024) === 0) {
				console.log(`Downloaded ${(bytes / 1024 / 1024).toFixed(0)} MB...`)
			}
		},
	})

	console.log('Download complete. Processing...')

	// Step 2: Decompress and parse CSV
	const entries: CaseIndexEntry[] = []
	let lineCount = 0
	let headerMap: Map<string, number> | null = null

	// Use bunzip2 system command to decompress (Node's zlib doesn't support bz2)
	const bunzip2 = spawn('bunzip2', ['-c', tempFile])

	// Parse CSV line by line
	const rl = readline.createInterface({
		input: bunzip2.stdout,
		crlfDelay: Infinity,
	})

	for await (const line of rl) {
		lineCount++

		if (lineCount === 1) {
			// Parse header
			headerMap = parseCSVHeader(line)
			continue
		}

		try {
			const entry = parseCSVLineToEntry(line, headerMap!)
			if (entry) {
				entries.push(entry)
			}
		} catch (err) {
			console.error(`Error parsing line ${lineCount}:`, err)
		}

		// Progress indicator
		if (lineCount % 100000 === 0) {
			console.log(`Processed ${lineCount} lines, ${entries.length} entries...`)
		}
	}

	console.log(`\nTotal: ${entries.length} cases indexed`)

	// Step 3: Write NDJSON output
	console.log(`Writing index to ${OUTPUT_FILE}...`)

	const outputStream = createWriteStream(OUTPUT_FILE)
	for (const entry of entries) {
		outputStream.write(JSON.stringify(entry) + '\n')
	}
	outputStream.end()

	await new Promise<void>((resolve, reject) => {
		outputStream.on('finish', () => resolve())
		outputStream.on('error', reject)
	})

	console.log('Index build complete!')
	const indexStats = await stat(OUTPUT_FILE)
	console.log(`File size: ${(indexStats.size / 1024 / 1024).toFixed(2)} MB`)

	// Optional: Compress with zstd
	console.log('\nTo compress the index for distribution:')
	console.log(`  zstd -19 ${OUTPUT_FILE} -o ${OUTPUT_FILE}.zst`)
}

/**
 * Parse CSV header row into column index map.
 */
function parseCSVHeader(line: string): Map<string, number> {
	const columns = parseCSVLine(line)
	const map = new Map<string, number>()

	columns.forEach((col, index) => {
		map.set(col, index)
	})

	return map
}

/**
 * Parse a CSV line (handling quotes and escapes).
 */
function parseCSVLine(line: string): string[] {
	const result: string[] = []
	let current = ''
	let inQuotes = false

	for (let i = 0; i < line.length; i++) {
		const char = line[i]
		const nextChar = line[i + 1]

		if (char === '"') {
			if (inQuotes && nextChar === '"') {
				// Escaped quote
				current += '"'
				i++
			} else {
				// Toggle quote state
				inQuotes = !inQuotes
			}
		} else if (char === ',' && !inQuotes) {
			// End of field
			result.push(current)
			current = ''
		} else if (char === '\\' && nextChar) {
			// Escape character
			current += nextChar
			i++
		} else {
			current += char
		}
	}

	// Add last field
	result.push(current)
	return result
}

/**
 * Parse CSV line into CaseIndexEntry using header map.
 */
function parseCSVLineToEntry(line: string, headerMap: Map<string, number>): CaseIndexEntry | null {
	const columns = parseCSVLine(line)

	// Extract required fields
	const id = columns[headerMap.get('id') || 0]
	const caseName = columns[headerMap.get('case_name') || 0]
	const caseNameFull = columns[headerMap.get('case_name_full') || 0]
	const courtId = columns[headerMap.get('court_id') || 0]
	const dateFiled = columns[headerMap.get('date_filed') || 0]

	if (!id || !caseName || !courtId || !dateFiled) {
		return null
	}

	return {
		id: parseInt(id, 10),
		name: caseName,
		full_name: caseNameFull || caseName,
		court: '', // Will be filled from courts CSV
		court_id: courtId,
		date: dateFiled,
		citation: columns[headerMap.get('citation') || -1],
		judge: columns[headerMap.get('judges') || -1],
		snippet: columns[headerMap.get('headnotes') || -1]?.slice(0, 200),
	}
}

// Run the build process
buildCaseIndex().catch((err) => {
	console.error('Failed to build index:', err)
	process.exit(1)
})

export { buildCaseIndex }
