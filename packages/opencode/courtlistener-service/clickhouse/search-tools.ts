/**
 * CourtListener search tools using ClickHouse SDK
 * Implements the 4-stage search funnel: Configure → Metadata → Keywords → Regex
 */

import { Tool } from '../../src/tool/tool'
import z from 'zod/v4'
import { getClickHouseClient } from './client'
import { buildWhereClause } from './query'
import type { SearchFilters } from './types'
import { cacheOpinionFromClickHouse, fetchOpinionFromCache, searchOpinionContent } from '../opinion-cache'
import { getCacheStateManager } from './cache-state'
import { getThreadStateManager } from './thread-state'

/**
 * Extract thread ID from tool context
 * Uses sessionID as the unique identifier for conversation state
 */
function getThreadId(ctx: any): string {
	return ctx.sessionID || 'default'
}

/**
 * Tool 1: Configure search filters (states, courts, date ranges)
 */
export const courtlistenerConfigureFilters = Tool.define('courtlistener_configure_filters', {
	description: `Configure search filters for CourtListener queries. 
Sets persistent filters that apply to subsequent metadata and keyword searches.
Call this FIRST before any search to narrow the scope.

Examples:
- states: ['CA', 'NY', 'TX']
- courts: ['ca', 'cacd', 'scotus']
- dateRange: ['2020-01-01', '2024-12-31']
- precedentialStatus: ['Published']`,

	parameters: z.object({
		states: z.array(z.string()).optional().describe('2-letter state codes (e.g., CA, NY)'),
		courts: z.array(z.string()).optional().describe('Court identifiers (e.g., scotus, ca, cacd)'),
		dateRange: z
			.tuple([z.string(), z.string()])
			.optional()
			.describe('Date range [start, end] in YYYY-MM-DD format'),
		precedentialStatus: z.array(z.string()).optional().describe('Status (e.g., Published, Unpublished)'),
		clear: z.boolean().optional().describe('Clear all active filters'),
	}),

	// @ts-expect-error - TypeScript infers return type incorrectly with union types
	async execute(params: any, ctx: any) {
		const threadId = getThreadId(ctx)
		const threadState = getThreadStateManager()
		const cacheState = getCacheStateManager()

		if (params.clear) {
			threadState.clearThread(threadId)
			cacheState.clearThread(threadId)
			return {
				title: 'Filters and cache cleared',
				output: `All search filters and cached results have been reset for thread ${threadId}.`,
				metadata: { threadId },
			}
		}

		// Update active filters
		const updates: Partial<SearchFilters> = {}
		if (params.states) updates.states = params.states
		if (params.courts) updates.courts = params.courts
		if (params.dateRange) updates.dateRange = params.dateRange
		if (params.precedentialStatus) updates.precedentialStatus = params.precedentialStatus

		threadState.updateFilters(threadId, updates)
		const activeFilters = threadState.getFilters(threadId)

		const filterSummary = Object.entries(activeFilters)
			.filter(([_, v]) => v && (Array.isArray(v) ? v.length > 0 : true))
			.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
			.join('\n')

		return {
			title: 'Filters configured',
			output: `Active filters:\n${filterSummary || 'None'}`,
			metadata: { activeFilters, threadId },
		}
	},
})

/**
 * Tool 2: Search metadata (fast filter on case names, dates, courts)
 */
export const courtlistenerSearchMetadata = Tool.define('courtlistener_search_metadata', {
	description: `Search CourtListener metadata (case names, dates, courts).
This is the FIRST search stage - returns cluster IDs for keyword search.
Very fast (<1s for millions of cases).

Uses active filters from courtlistener_configure_filters.

Examples:
- caseNameKeywords: ['DUI', 'moped']
- judge: 'Smith'`,

	parameters: z.object({
		caseNameKeywords: z.array(z.string()).optional().describe('Keywords to match in case_name field'),
		judge: z.string().optional().describe('Judge name to match'),
		limit: z.number().optional().describe('Max results (default: 1000)'),
	}),

	// @ts-expect-error - TypeScript infers return type incorrectly with union types
	async execute(params: any, ctx: any) {
		const threadId = getThreadId(ctx)
		const threadState = getThreadStateManager()
		const { caseNameKeywords, judge, limit = 1000 } = params
		const client = getClickHouseClient()

		// Build WHERE clause from active filters + parameters
		const activeFilters = threadState.getFilters(threadId)
		const conditions: string[] = []
		const whereClause = buildWhereClause(activeFilters)
		if (whereClause) conditions.push(whereClause.replace('WHERE ', ''))

		if (caseNameKeywords && caseNameKeywords.length > 0) {
			const keywordConditions = caseNameKeywords.map((kw: string) => `case_name ILIKE '%${kw}%'`).join(' OR ')
			conditions.push(`(${keywordConditions})`)
		}

		if (judge) {
			conditions.push(`judges ILIKE '%${judge}%'`)
		}

		const finalWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

		const query = `
      SELECT 
        id,
        case_name,
        case_name_short,
        date_filed,
        judges,
        docket_id,
        precedential_status
      FROM opinion_clusters
      ${finalWhere}
      ORDER BY date_filed DESC
      LIMIT ${limit}
    `

		try {
			const result = await client.query({
				query,
				format: 'JSONEachRow',
			})

			const clusters = await result.json<{
				id: number
				case_name: string
				case_name_short: string
				date_filed: string
				judges: string
				docket_id: number
				precedential_status: string
			}>()

			if (clusters.length === 0) {
				return {
					title: 'No results',
					output: 'No cases match the metadata criteria.',
					metadata: { clusterIds: [], count: 0 },
				}
			}

			const output = `Found ${clusters.length} cases:\n\n` + clusters.slice(0, 10).map((c) => `• ${c.case_name_short} (${c.date_filed})`).join('\n') + (clusters.length > 10 ? `\n... and ${clusters.length - 10} more` : '')

			// Cache cluster IDs for next tool
			const clusterIds = clusters.map((c) => c.id)
			threadState.setCachedClusterIds(threadId, clusterIds)

			return {
				title: `${clusters.length} cases found`,
				output: output + '\n\nCached cluster IDs for keyword search. Call courtlistener_search_keywords next.',
				metadata: {
					count: clusters.length,
					clusterIds,
					clusters: clusters.slice(0, 50), // Limit metadata size
					threadId,
				},
			}
		} catch (error) {
			return {
				title: 'Search failed',
				output: `Error: ${error instanceof Error ? error.message : String(error)}`,
				metadata: { error: true },
			}
		}
	},
})

/**
 * Tool 3: Search keywords in opinion full text
 */
export const courtlistenerSearchKeywords = Tool.define('courtlistener_search_keywords', {
	description: `Search keywords in opinion full text using ClickHouse.
This is the SECOND search stage - takes cluster IDs from metadata search.
Slower (5-30s) but still fast for ClickHouse indexed search.

Examples:
- keywords: ['moped', 'motorized', 'bicycle', 'DUI']
- requireAll: false (match ANY keyword)`,

	parameters: z.object({
		clusterIds: z.array(z.number()).optional().describe('Cluster IDs from metadata search (uses cached IDs if not provided)'),
		keywords: z.array(z.string()).describe('Keywords to search in opinion text'),
		requireAll: z.boolean().optional().describe('Require all keywords (AND) vs any (OR). Default: false'),
		limit: z.number().optional().describe('Max results (default: 500)'),
	}),

	// @ts-expect-error - TypeScript infers return type incorrectly with union types
	async execute(params: any, ctx: any) {
		const threadId = getThreadId(ctx)
		const threadState = getThreadStateManager()
		const { keywords, requireAll = false, limit = 500 } = params
		const client = getClickHouseClient()

		// Use provided cluster IDs or fall back to cached ones
		const cachedClusterIds = threadState.getCachedClusterIds(threadId)
		const clusterIds = params.clusterIds || cachedClusterIds

		if (clusterIds.length === 0) {
			return {
				title: 'No clusters available',
				output: 'Run courtlistener_search_metadata first to get cluster IDs, or provide clusterIds parameter.',
				metadata: { opinionIds: [], threadId },
			}
		}

		// Build keyword search conditions
		const keywordConditions = keywords.map((kw: string) => `positionCaseInsensitive(plain_text, '${kw}') > 0`).join(requireAll ? ' AND ' : ' OR ')

		const query = `
      SELECT 
        o.id,
        o.cluster_id,
        o.type,
        o.author_str,
        o.plain_text,
        o.page_count,
        c.case_name,
        c.case_name_short,
        c.date_filed
      FROM opinions o
      LEFT JOIN opinion_clusters c ON o.cluster_id = c.id
      WHERE o.cluster_id IN (${clusterIds.join(',')})
        AND (${keywordConditions})
      ORDER BY o.cluster_id DESC
      LIMIT ${limit}
    `

		try {
			const result = await client.query({
				query,
				format: 'JSONEachRow',
			})

			const opinions = await result.json<{
				id: number
				cluster_id: number
				type: string
				author_str: string
				plain_text: string
				page_count: number
				case_name: string
				case_name_short: string
				date_filed: string
			}>()

			if (opinions.length === 0) {
				return {
					title: 'No matches',
					output: `No opinions found with keywords: ${keywords.join(', ')}`,
					metadata: { opinionIds: [] },
				}
			}

			// Proactively cache opinion content in background (fire-and-forget)
			// This avoids slow API fetches in the next tool
			const cacheManager = getCacheStateManager()
			for (const o of opinions) {
				const cachePromise = cacheOpinionFromClickHouse(o.id, {
					id: o.id,
					cluster_id: o.cluster_id,
					type: o.type,
					plain_text: o.plain_text,
					author_str: o.author_str,
					case_name: o.case_name,
					case_name_full: o.case_name,
					court: '', // Not fetched in this query
					date_filed: o.date_filed,
				}).catch((err) => {
					console.error(`Failed to cache opinion ${o.id}:`, err)
				})
				cacheManager.registerCacheOperation(threadId, o.id, cachePromise)
			}

			const output = `Found ${opinions.length} opinions:\n\n` + opinions.slice(0, 10).map((o) => `• Opinion ${o.id} (${o.case_name_short}) - ${o.type} by ${o.author_str || 'Unknown'}`).join('\n') + (opinions.length > 10 ? `\n... and ${opinions.length - 10} more` : '')

			// Cache opinion IDs for next tool
			const opinionIds = opinions.map((o) => o.id)
			threadState.setCachedOpinionIds(threadId, opinionIds)

			return {
				title: `${opinions.length} opinions found`,
				output:
					output +
					`\n\n✅ Cached ${opinions.length} opinion IDs. Caching full text in background...` +
					'\n📝 Call courtlistener_regex_search next (will wait for cache if needed).',
				metadata: {
					count: opinions.length,
					opinionIds,
					opinions: opinions.slice(0, 50),
					threadId,
				},
			}
		} catch (error) {
			return {
				title: 'Search failed',
				output: `Error: ${error instanceof Error ? error.message : String(error)}`,
				metadata: { error: true },
			}
		}
	},
})

/**
 * Tool 4: Regex search on cached opinion text (final precision stage)
 */
export const courtlistenerRegexSearch = Tool.define('courtlistener_regex_search', {
	description: `Search opinions using regex patterns with ripgrep.
This is the FINAL search stage - takes opinion IDs from keyword search.
Uses cached opinion text for fast regex matching.

Supports Rust regex syntax (same as ripgrep):
- \\b for word boundaries
- (?i) for case-insensitive
- .{0,20} for proximity
- | for alternatives

Examples:
- pattern='\\b(habeas|mandamus)\\s+corpus\\b'
- pattern='\\d{2}-\\d{4}' (case numbers)
- pattern='(?i)relief.*granted' (case-insensitive)`,

	parameters: z.object({
		opinionIds: z.array(z.number()).optional().describe('Opinion IDs from keyword search (uses cached IDs if not provided)'),
		pattern: z.string().describe('Regex pattern (Rust regex syntax)'),
		contextLines: z.number().optional().describe('Lines of context (default: 3)'),
	}),

	// @ts-expect-error - TypeScript infers return type incorrectly with union types
	async execute(params: any, ctx: any) {
		const threadId = getThreadId(ctx)
		const threadState = getThreadStateManager()
		const { pattern, contextLines = 3 } = params

		// Use provided opinion IDs or fall back to cached ones
		const cachedOpinionIds = threadState.getCachedOpinionIds(threadId)
		const opinionIds = params.opinionIds || cachedOpinionIds

		if (opinionIds.length === 0) {
			return {
				title: 'No opinions available',
				output: 'Run courtlistener_search_keywords first to get opinion IDs, or provide opinionIds parameter.',
				metadata: { matches: [], threadId },
			}
		}

		try {
			// Check if background caching is in progress
			const cacheManager = getCacheStateManager()
			const cacheStatus = cacheManager.getCacheStatus(threadId, opinionIds)

			// Wait for any pending cache operations
			if (cacheStatus.pending > 0) {
				const waitResult = await cacheManager.waitForCache(threadId, opinionIds)
				console.log(
					`[Regex Search][${threadId}] Waited for ${waitResult.waited} cache ops, ${waitResult.alreadyDone} already done, ${cacheStatus.notStarted} not started`,
				)
			}

			// Fetch any opinions not yet cached (fallback to API)
			const cachePromises = opinionIds.map((id: number) => fetchOpinionFromCache(id, ctx.abort))
			await Promise.all(cachePromises)

			// Run ripgrep on cached files
			const matches = await searchOpinionContent(opinionIds, pattern, {
				contextLines,
				maxMatches: 50,
				signal: ctx.abort,
			})

			if (matches.length === 0) {
				return {
					title: 'No matches found',
					output: `Pattern '${pattern}' found 0 matches in ${opinionIds.length} opinions`,
					metadata: { matches: [] },
				}
			}

			const output = `Found ${matches.length} matches:\n\n` + matches.slice(0, 10).map((m) => `Opinion ${m.opinionId} (Line ${m.lineNumber}):\n  ${m.matchText.substring(0, 200)}${m.matchText.length > 200 ? '...' : ''}\n`).join('\n') + (matches.length > 10 ? `\n... and ${matches.length - 10} more matches` : '')

			return {
				title: `${matches.length} regex matches`,
				output: output + '\n\nUse courtlistener_read to get full opinion text.',
				metadata: {
					count: matches.length,
					matches,
					opinionIds: [...new Set(matches.map((m) => m.opinionId))],
					threadId,
				},
			}
		} catch (error) {
			return {
				title: 'Search failed',
				output: `Error: ${error instanceof Error ? error.message : String(error)}`,
				metadata: { error: true, threadId },
			}
		}
	},
})

// Export all tools
export const courtlistenerTools = [
	courtlistenerConfigureFilters,
	courtlistenerSearchMetadata,
	courtlistenerSearchKeywords,
	courtlistenerRegexSearch,
]
