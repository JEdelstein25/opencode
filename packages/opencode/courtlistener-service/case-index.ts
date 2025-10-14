/**
 * Case name index search (Tier 1 cache).
 * Searches the compressed case index using in-memory glob matching.
 */

import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import picomatch from 'picomatch/posix'
import type { CaseIndexEntry, SearchCaseIndexOptions } from './types'

const CASE_INDEX_PATH = process.env.COURTLISTENER_INDEX_PATH || '/tmp/cache/tier1/case_index.ndjson'

let cachedIndex: CaseIndexEntry[] | null = null

async function loadCaseIndex(signal?: AbortSignal): Promise<CaseIndexEntry[]> {
	if (cachedIndex) {
		return cachedIndex
	}

	const entries: CaseIndexEntry[] = []
	const fileStream = createReadStream(CASE_INDEX_PATH, { signal: signal as any })
	const rl = createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	})

	for await (const line of rl) {
		if (signal?.aborted) {
			throw new Error('Aborted')
		}
		try {
			const entry: CaseIndexEntry = JSON.parse(line)
			entries.push(entry)
		} catch (err) {
			continue
		}
	}

	cachedIndex = entries
	return entries
}

export async function searchCaseIndex(options: SearchCaseIndexOptions): Promise<number[]> {
	const { pattern, court, dateRange, limit = 100, signal } = options

	const entries = await loadCaseIndex(signal)

	const isMatch = picomatch(pattern, {
		contains: true,
		nocase: true,
	})

	const matched: number[] = []
	for (const entry of entries) {
		if (matched.length >= limit) break
		if (signal?.aborted) break

		if (!isMatch(entry.name) && !isMatch(entry.full_name)) {
			continue
		}

		if (court && !court.includes(entry.court_id)) {
			continue
		}

		if (dateRange) {
			const [start, end] = dateRange
			if (entry.date < start || entry.date > end) {
				continue
			}
		}

		matched.push(entry.id)
	}

	return matched
}

export async function getCaseMetadata(caseIds: number[], signal?: AbortSignal): Promise<CaseIndexEntry[]> {
	const entries = await loadCaseIndex(signal)
	const idSet = new Set(caseIds)

	return entries.filter((entry) => idSet.has(entry.id))
}

export function clearCaseIndexCache(): void {
	cachedIndex = null
}
