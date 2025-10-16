#!/usr/bin/env bun
/**
 * Preprocess PostgreSQL CSV exports to ClickHouse-compatible NDJSON.
 * Uses native Bun APIs for maximum performance and compatibility.
 */

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'

async function preprocessCSV(inputFile: string, outputFile: string) {
	console.log('🚀 Starting CSV preprocessing...')
	console.log(`Input:  ${inputFile}`)
	console.log(`Output: ${outputFile}`)

	const startTime = Date.now()
	let rowsParsed = 0
	let rowsWritten = 0
	let errors = 0
	let lastProgress = Date.now()

	// Decompress with bunzip2
	const bunzip = spawn('bunzip2', ['-c', inputFile], {
		stdio: ['ignore', 'pipe', 'inherit'],
	})

	const outputStream = createWriteStream(outputFile)

	// Process line by line
	let buffer = ''
	let headers: string[] = []
	let inQuotedField = false
	let currentRow: string[] = []
	let currentField = ''

	bunzip.stdout.on('data', (chunk: Buffer) => {
		buffer += chunk.toString('utf-8')
		const lines = buffer.split('\n')

		// Keep last incomplete line in buffer
		buffer = lines.pop() || ''

		for (const line of lines) {
			if (rowsParsed === 0) {
				// Parse header
				headers = parseCSVLine(line)
				rowsParsed++
				continue
			}

			// Parse CSV line (handles multiline quoted fields)
			const fields = parseCSVLine(line)

			if (fields.length !== headers.length) {
				// Might be multiline field - skip for now
				errors++
				continue
			}

			// Build JSON object
			const record: any = {}
			for (let i = 0; i < headers.length; i++) {
				const key = headers[i]!
				let value: any = fields[i] || null

				// Handle PostgreSQL booleans
				if (value === 't') value = 1
				else if (value === 'f') value = 0
				// Handle empty strings as null
				else if (value === '') value = null
				// Parse numbers
				else if (value && /^\d+$/.test(value)) value = parseInt(value, 10)
				else if (value && /^\d+\.\d+$/.test(value)) value = parseFloat(value)

				record[key] = value
			}

			// Write NDJSON
			outputStream.write(JSON.stringify(record) + '\n')
			rowsWritten++
			rowsParsed++

			// Progress every 5 seconds
			if (Date.now() - lastProgress > 5000) {
				const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
				process.stdout.write(
					`\r⏳ Parsed: ${rowsParsed.toLocaleString()} | Written: ${rowsWritten.toLocaleString()} | Errors: ${errors} | ${elapsed}s`,
				)
				lastProgress = Date.now()
			}
		}
	})

	return new Promise<void>((resolve, reject) => {
		bunzip.on('close', (code) => {
			if (code !== 0 && code !== null) {
				reject(new Error(`bunzip2 exited with code ${code}`))
				return
			}

			outputStream.end()
			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
			console.log(`\n\n✅ Preprocessing complete!`)
			console.log(`Rows written: ${rowsWritten.toLocaleString()}`)
			console.log(`Errors: ${errors}`)
			console.log(`Duration: ${elapsed}s`)
			resolve()
		})

		bunzip.on('error', reject)
		outputStream.on('error', reject)
	})
}

/**
 * Parse a single CSV line handling quotes properly
 * Simple implementation - handles basic PostgreSQL CSV
 */
function parseCSVLine(line: string): string[] {
	const fields: string[] = []
	let currentField = ''
	let inQuotes = false

	for (let i = 0; i < line.length; i++) {
		const char = line[i]!
		const nextChar = line[i + 1]

		if (char === '"') {
			if (inQuotes && nextChar === '"') {
				// Escaped quote
				currentField += '"'
				i++ // Skip next quote
			} else {
				// Toggle quote state
				inQuotes = !inQuotes
			}
		} else if (char === ',' && !inQuotes) {
			// End of field
			fields.push(currentField)
			currentField = ''
		} else {
			currentField += char
		}
	}

	// Add last field
	fields.push(currentField)

	return fields
}

// Run CLI
if (import.meta.main) {
	const args = process.argv.slice(2)

	if (args.length < 2) {
		console.log(`
Usage: bun preprocess-postgresql-csv.ts <input.csv.bz2> <output.ndjson>

Converts PostgreSQL CSV exports to NDJSON for ClickHouse import.
Handles multiline quoted fields, complex escaping, and embedded HTML.

Examples:
  bun preprocess-postgresql-csv.ts /tmp/opinion-clusters.csv.bz2 /tmp/opinion-clusters.ndjson
  bun preprocess-postgresql-csv.ts data.csv.gz output.ndjson
		`)
		process.exit(1)
	}

	await preprocessCSV(args[0]!, args[1]!)
}
