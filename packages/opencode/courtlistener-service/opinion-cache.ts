/**
 * Opinion content cache (Tier 2 cache).
 * Manages fetching, caching, and searching legal opinions.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { COURTLISTENER_API_BASE_URL, fetchFromCLAPI } from './fetch-cl-api'
import type { Opinion, SearchMatch, SearchOpinionContentOptions } from './types'

const TIER2_CACHE_DIR = process.env.COURTLISTENER_CACHE_DIR || '/tmp/cache/tier2/opinions'
const TIER2_MAX_SIZE = 10 * 1024 ** 3 // 10 GB
const TIER2_TARGET_SIZE = 9 * 1024 ** 3

interface CacheMetadata {
	opinionId: number
	lastAccessed: number
	size: number
}

const metadataCache = new Map<number, CacheMetadata>()

async function ensureCacheDir(): Promise<void> {
	if (!existsSync(TIER2_CACHE_DIR)) {
		await mkdir(TIER2_CACHE_DIR, { recursive: true })
	}
}

function touchCacheEntry(opinionId: number): void {
	const metadata = metadataCache.get(opinionId)
	if (metadata) {
		metadata.lastAccessed = Date.now()
	}
}

async function updateCacheMetadata(opinionId: number, opinion: Opinion): Promise<void> {
	const size = JSON.stringify(opinion).length
	metadataCache.set(opinionId, {
		opinionId,
		lastAccessed: Date.now(),
		size,
	})
}

function getTotalCacheSize(): number {
	let total = 0
	for (const metadata of Array.from(metadataCache.values())) {
		total += metadata.size
	}
	return total
}

async function evictIfOverLimit(): Promise<void> {
	const totalSize = getTotalCacheSize()
	if (totalSize <= TIER2_MAX_SIZE) {
		return
	}

	const entries = Array.from(metadataCache.values()).sort((a, b) => a.lastAccessed - b.lastAccessed)

	let currentSize = totalSize
	for (const entry of entries) {
		if (currentSize <= TIER2_TARGET_SIZE) {
			break
		}

		const jsonPath = join(TIER2_CACHE_DIR, `${entry.opinionId}.json`)
		const txtPath = join(TIER2_CACHE_DIR, `${entry.opinionId}.txt`)

		try {
			await unlink(jsonPath)
			await unlink(txtPath)
			metadataCache.delete(entry.opinionId)
			currentSize -= entry.size
		} catch (err) {
			// Continue
		}
	}
}

export async function loadCacheMetadata(): Promise<void> {
	await ensureCacheDir()

	try {
		const files = await readdir(TIER2_CACHE_DIR)
		for (const file of files) {
			if (!file.endsWith('.json')) continue

			const match = file.match(/^(\d+)\.json$/)
			if (!match?.[1]) continue

			const opinionId = parseInt(match[1]!, 10)
			const filePath = join(TIER2_CACHE_DIR, file)

			try {
				const stats = await stat(filePath)
				metadataCache.set(opinionId, {
					opinionId,
					lastAccessed: stats.mtimeMs,
					size: stats.size,
				})
			} catch (err) {
				// Skip
			}
		}
	} catch (err) {
		// Cache dir doesn't exist yet
	}
}

export async function fetchOpinionFromCache(opinionId: number, signal?: AbortSignal): Promise<Opinion | null> {
	await ensureCacheDir()

	const cachedPath = join(TIER2_CACHE_DIR, `${opinionId}.json`)

	try {
		const cached = await readFile(cachedPath, 'utf-8')
		touchCacheEntry(opinionId)
		return JSON.parse(cached)
	} catch (err) {
		// Not in cache
	}

	// Fetch from CourtListener API
	const response = await fetchFromCLAPI<Opinion>(`${COURTLISTENER_API_BASE_URL}/opinions/${opinionId}/`, { signal })

	if (!response.ok) {
		if (response.status === 404) return null
		throw new Error(`CourtListener API error: ${response.status} ${response.statusText || 'Unknown error'}`)
	}

	if (!response.data) {
		throw new Error('No data received from CourtListener API')
	}

	const opinion = response.data

	await writeFile(cachedPath, JSON.stringify(opinion, null, 2))
	await updateCacheMetadata(opinionId, opinion)
	await addToRipgrepCache(opinionId, opinion)
	await evictIfOverLimit()

	return opinion
}

async function addToRipgrepCache(opinionId: number, opinion: Opinion): Promise<void> {
	const textPath = join(TIER2_CACHE_DIR, `${opinionId}.txt`)

	const opinionText = opinion.html_with_citations || opinion.plain_text || opinion.html || 'No text available'

	const searchableText = `
Case: ${opinion.case_name}
Full Name: ${opinion.case_name_full}
Type: ${opinion.type}
Court: ${opinion.court}
Date: ${opinion.date_filed}
Author: ${opinion.author_str || 'N/A'}
Per Curiam: ${opinion.per_curiam}
Judges: ${opinion.judges?.join(', ') || 'N/A'}
Citations: ${opinion.citations?.join(', ') || 'N/A'}
SHA1: ${opinion.sha1 || 'N/A'}

${opinionText}
	`.trim()

	await writeFile(textPath, searchableText)
}

export async function searchOpinionContent(
	opinionIds: number[],
	pattern: string,
	options?: SearchOpinionContentOptions,
): Promise<SearchMatch[]> {
	const { contextLines = 3, maxMatches = 50, signal } = options || {}

	const filePaths = opinionIds.map((id) => join(TIER2_CACHE_DIR, `${id}.txt`))

	const existingPaths: string[] = []
	for (const path of filePaths) {
		if (existsSync(path)) {
			existingPaths.push(path)
		}
	}

	if (existingPaths.length === 0) {
		return []
	}

	const rga = spawn(
		'rga',
		['--json', `-C${contextLines}`, '--max-count', maxMatches.toString(), pattern, ...existingPaths],
		{
			signal: signal as any,
		},
	)

	const matches: SearchMatch[] = []

	return new Promise((resolve, reject) => {
		let output = ''

		rga.stdout.on('data', (data) => {
			output += data.toString()
		})

		rga.stderr.on('data', (data) => {
			// Log but don't fail
		})

		rga.on('close', (code) => {
			if (signal?.aborted) {
				reject(new Error('Aborted'))
				return
			}

			const lines = output.split('\n').filter((line) => line.trim())
			for (const line of lines) {
				try {
					const match = JSON.parse(line)
					if (match.type !== 'match') continue

					const pathMatch = match.data.path.text.match(/(\d+)\.txt$/)
					if (!pathMatch) continue
					const opinionId = parseInt(pathMatch[1], 10)

					matches.push({
						opinionId,
						lineNumber: match.data.line_number,
						matchText: match.data.lines.text,
						contextBefore: match.data.submatches?.before || [],
						contextAfter: match.data.submatches?.after || [],
					})
				} catch (err) {
					continue
				}
			}

			resolve(matches)
		})

		rga.on('error', (err) => {
			reject(err)
		})
	})
}

export async function clearOpinionCache(): Promise<void> {
	const files = await readdir(TIER2_CACHE_DIR)
	for (const file of files) {
		await unlink(join(TIER2_CACHE_DIR, file))
	}
	metadataCache.clear()
}
