/**
 * Case name index search (Tier 1 cache).
 * Uses ripgrep for fast searching of NDJSON file.
 */

import { spawn } from 'node:child_process'
import type { CaseIndexEntry, SearchCaseIndexOptions } from './types'

const CASE_INDEX_PATH = process.env.COURTLISTENER_INDEX_PATH || '/tmp/cache/tier1/case_index.ndjson'

function globToRegex(pattern: string): string {
	return pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.')
}

export async function searchCaseIndex(options: SearchCaseIndexOptions): Promise<{ ids: number[]; entries: CaseIndexEntry[] }> {
	const { pattern, court, dateRange, limit = 100, signal } = options

	const regex = globToRegex(pattern)

	return new Promise((resolve, reject) => {
		const rg = spawn('rg', ['-i', '--json', '-m', (limit * 2).toString(), regex, CASE_INDEX_PATH], {
			signal: signal as any,
		})

		const matched: number[] = []
		const entries: CaseIndexEntry[] = []
		let buffer = ''
		let killed = false

		rg.stdout.on('data', (data) => {
			if (killed) return

			buffer += data.toString()
			const lines = buffer.split('\n')
			buffer = lines.pop() || ''

			for (const line of lines) {
				if (!line.trim() || killed) continue

				try {
					const match = JSON.parse(line)
					if (match.type !== 'match') continue

					const entry: CaseIndexEntry = JSON.parse(match.data.lines.text)

					if (court && !court.includes(entry.court_id)) continue

					if (dateRange) {
						const [start, end] = dateRange
						if (entry.date < start || entry.date > end) continue
					}

					matched.push(entry.id)
					entries.push(entry)

					if (matched.length >= limit) {
						killed = true
						rg.kill('SIGTERM')
						resolve({ ids: matched, entries })
						break
					}
				} catch (err) {
					continue
				}
			}
		})

		rg.on('close', () => {
			if (!killed) resolve({ ids: matched, entries })
		})

		rg.on('error', (err) => {
			if (!killed) reject(err)
		})
	})
}

export async function getCaseMetadata(caseIds: number[], signal?: AbortSignal): Promise<CaseIndexEntry[]> {
	const idPattern = caseIds.map((id) => `^{"id":${id},`).join('|')

	return new Promise((resolve, reject) => {
		const rg = spawn('rg', ['--json', idPattern, CASE_INDEX_PATH], {
			signal: signal as any,
		})

		const entries: CaseIndexEntry[] = []
		let output = ''

		rg.stdout.on('data', (data) => {
			output += data.toString()
		})

		rg.on('close', () => {
			if (signal?.aborted) {
				reject(new Error('Aborted'))
				return
			}

			const lines = output.split('\n').filter((line) => line.trim())
			for (const line of lines) {
				try {
					const match = JSON.parse(line)
					if (match.type !== 'match') continue
					const entry: CaseIndexEntry = JSON.parse(match.data.lines.text)
					entries.push(entry)
				} catch (err) {
					continue
				}
			}

			resolve(entries)
		})

		rg.on('error', (err) => {
			reject(err)
		})
	})
}
