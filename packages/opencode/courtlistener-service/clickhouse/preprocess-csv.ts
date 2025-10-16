#!/usr/bin/env bun
/**
 * Preprocess PostgreSQL CSV exports for ClickHouse import.
 * Handles multiline fields, complex quoting, and embedded HTML.
 * Outputs NDJSON (one JSON object per line) for reliable ClickHouse import.
 */

import { createReadStream, createWriteStream } from 'node:fs'
import { createBrotliDecompress, createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { parse } from '../node_modules/csv-parse/dist/esm/index.js'
import { Transform } from 'node:stream'
import { spawn } from 'node:child_process'

interface PreprocessOptions {
	inputFile: string
	outputFile: string
	compression?: 'bz2' | 'gzip' | 'none'
	onProgress?: (stats: { rowsParsed: number; rowsWritten: number; errors: number }) => void
}

/**
 * Preprocess PostgreSQL CSV to NDJSON for ClickHouse
 */
export async function preprocessCSV(options: PreprocessOptions): Promise<void> {
	const { inputFile, outputFile, compression = 'bz2', onProgress } = options

	let rowsParsed = 0
	let rowsWritten = 0
	let errors = 0
	let lastProgress = Date.now()

	// Create decompression stream based on format
	const inputStream = createReadStream(inputFile)
	let decompressor: any

	if (compression === 'bz2') {
		// Use bunzip2 command (more reliable than Node.js bz2 libs)
		decompressor = spawn('bunzip2', ['-c'], { stdio: ['pipe', 'pipe', 'inherit'] })
		inputStream.pipe(decompressor.stdin)
	} else if (compression === 'gzip') {
		decompressor = createGunzip()
		inputStream.pipe(decompressor)
	} else {
		decompressor = inputStream
	}

	// CSV parser with PostgreSQL-compatible settings
	const parser = parse({
		quote: '"',
		escape: '"',
		delimiter: ',',
		relax_quotes: true,
		relax_column_count: true,
		skip_empty_lines: true,
		trim: false,
		columns: true, // Use first row as column names
		cast: false, // Keep everything as strings
		on_record: (record: any) => {
			rowsParsed++

			// Report progress every 5 seconds
			if (Date.now() - lastProgress > 5000) {
				onProgress?.({ rowsParsed, rowsWritten, errors })
				lastProgress = Date.now()
			}

			return record
		},
	})

	// Transform to NDJSON
	const toNDJSON = new Transform({
		objectMode: true,
		transform(record: any, encoding, callback) {
			try {
				// Clean and normalize the record
				const cleaned = cleanRecord(record)
				const json = JSON.stringify(cleaned) + '\n'
				rowsWritten++
				callback(null, json)
			} catch (err) {
				errors++
				// Skip malformed rows
				callback()
			}
		},
	})

	// Output stream
	const outputStream = createWriteStream(outputFile)

	// Connect the pipeline
	const sourceStream = compression === 'bz2' ? decompressor.stdout : decompressor

	await pipeline(sourceStream, parser, toNDJSON, outputStream)

	// Final progress report
	onProgress?.({ rowsParsed, rowsWritten, errors })
}

/**
 * Clean and normalize a CSV record for ClickHouse
 */
function cleanRecord(record: any): any {
	const cleaned: any = {}

	for (const [key, value] of Object.entries(record)) {
		if (value === null || value === undefined || value === '') {
			cleaned[key] = null
			continue
		}

		const strValue = String(value)

		// Handle PostgreSQL boolean format
		if (strValue === 't') {
			cleaned[key] = 1
			continue
		}
		if (strValue === 'f') {
			cleaned[key] = 0
			continue
		}

		// Clean string fields
		let cleanedValue = strValue
			// Remove excessive whitespace
			.replace(/\s+/g, ' ')
			// Trim
			.trim()

		// Parse numbers if they look like numbers
		if (/^\d+$/.test(cleanedValue)) {
			cleaned[key] = parseInt(cleanedValue, 10)
		} else if (/^\d+\.\d+$/.test(cleanedValue)) {
			cleaned[key] = parseFloat(cleanedValue)
		} else {
			cleaned[key] = cleanedValue
		}
	}

	return cleaned
}

// CLI usage
if (import.meta.main) {
	const args = process.argv.slice(2)

	if (args.length < 2) {
		console.log(`
Usage: bun preprocess-csv.ts <input.csv.bz2> <output.ndjson>

Examples:
  bun preprocess-csv.ts opinion-clusters.csv.bz2 opinion-clusters.ndjson
  bun preprocess-csv.ts /tmp/data.csv.gz output.ndjson
		`)
		process.exit(1)
	}

	const [inputFile, outputFile] = args
	const compression = inputFile!.endsWith('.bz2') ? 'bz2' : inputFile!.endsWith('.gz') ? 'gzip' : 'none'

	console.log(`
📝 CSV Preprocessor
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Input:       ${inputFile}
Output:      ${outputFile}
Compression: ${compression}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
	`)

	const startTime = Date.now()

	await preprocessCSV({
		inputFile: inputFile!,
		outputFile: outputFile!,
		compression,
		onProgress: (stats) => {
			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
			process.stdout.write(
				`\r⏳ Parsed: ${stats.rowsParsed.toLocaleString()} | Written: ${stats.rowsWritten.toLocaleString()} | Errors: ${stats.errors} | Time: ${elapsed}s`,
			)
		},
	})

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
	console.log(`\n\n✅ Preprocessing complete in ${elapsed}s`)
	console.log(`\nNext: Import to ClickHouse with:`)
	console.log(`  bun clickhouse/cli-import.ts ${outputFile} --dataset opinion_clusters`)
}
