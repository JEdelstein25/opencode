/**
 * Simple HTTP server for CourtListener search tools.
 * Exposes the filesystem interface as REST API endpoints.
 */

import { createServer } from 'node:http'
import { getCaseMetadata, searchCaseIndex } from './case-index'
import { fetchOpinionFromCache, loadCacheMetadata, searchOpinionContent } from './opinion-cache'

const PORT = process.env.PORT || 3000

interface SearchCasesRequest {
	pattern: string
	court?: string[]
	dateRange?: [string, string]
	limit?: number
}

interface SearchContentRequest {
	caseIds: number[]
	query: string
	contextLines?: number
	maxMatches?: number
}

async function handleRequest(req: any, res: any): Promise<void> {
	res.setHeader('Access-Control-Allow-Origin', '*')
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

	if (req.method === 'OPTIONS') {
		res.writeHead(200)
		res.end()
		return
	}

	try {
		if (req.url === '/health' && req.method === 'GET') {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ status: 'healthy' }))
			return
		}

		const opinionMatch = req.url.match(/^\/api\/opinions\/(\d+)$/)
		if (opinionMatch && req.method === 'GET') {
			const opinionId = parseInt(opinionMatch[1], 10)
			const opinion = await fetchOpinionFromCache(opinionId)

			if (!opinion) {
				res.writeHead(404, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Opinion not found' }))
				return
			}

			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify(opinion))
			return
		}

		if (req.url === '/search/cases' && req.method === 'POST') {
			const body = await readBody<SearchCasesRequest>(req)

			const result = await searchCaseIndex({
				pattern: body.pattern,
				court: body.court,
				dateRange: body.dateRange,
				limit: body.limit,
			})

			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ caseIds: result.ids, cases: result.entries }))
			return
		}

		if (req.url === '/search/content' && req.method === 'POST') {
			const body = await readBody<SearchContentRequest>(req)

			const matches = await searchOpinionContent(body.caseIds, body.query, {
				contextLines: body.contextLines,
				maxMatches: body.maxMatches,
			})

			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ matches }))
			return
		}

		res.writeHead(404, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: 'Not found' }))
	} catch (error) {
		console.error('Request error:', error)
		res.writeHead(500, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: (error as Error).message }))
	}
}

async function readBody<T>(req: any): Promise<T> {
	return new Promise((resolve, reject) => {
		let body = ''
		req.on('data', (chunk: Buffer) => {
			body += chunk.toString()
		})
		req.on('end', () => {
			try {
				resolve(JSON.parse(body))
			} catch (err) {
				reject(new Error('Invalid JSON'))
			}
		})
		req.on('error', reject)
	})
}

async function main(): Promise<void> {
	console.log('Starting CourtListener search service...')

	await loadCacheMetadata()
	console.log('Cache metadata loaded')

	const server = createServer(handleRequest)

	server.listen(PORT, () => {
		console.log(`Server listening on http://localhost:${PORT}`)
		console.log('Endpoints:')
		console.log('  GET  /health')
		console.log('  GET  /api/opinions/:id')
		console.log('  POST /search/cases')
		console.log('  POST /search/content')
	})

	process.on('SIGTERM', () => {
		console.log('SIGTERM received, shutting down gracefully...')
		server.close(() => {
			console.log('Server closed')
			process.exit(0)
		})
	})
}

main().catch((err) => {
	console.error('Failed to start server:', err)
	process.exit(1)
})
