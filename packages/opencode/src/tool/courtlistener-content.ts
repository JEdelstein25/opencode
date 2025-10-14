import z from "zod/v4"
import { Tool } from "./tool"

const SERVICE_URL = process.env.COURTLISTENER_SERVICE_URL || "http://localhost:3000"

const DESCRIPTION = `Search within the text of specific legal opinions.

This tool performs full-text search within the opinions you specify by case ID. It uses regex patterns and returns matches with surrounding context.

Use this tool after courtlistener_search to search within specific cases for particular phrases or patterns.

Examples:
- Search for phrase: query="qualified immunity", caseIds=[12345, 67890]
- Search for citation: query="\\d{3} U\\.S\\. \\d+", caseIds=[12345]
- Search with context: query="separate but equal", contextLines=5`

export const CourtListenerContentSearchTool = Tool.define("courtlistener_content_search", {
	description: DESCRIPTION,
	parameters: z.object({
		caseIds: z.array(z.coerce.number()).describe("Array of case IDs to search within"),
		query: z.string().describe("Search query (supports regex patterns)"),
		contextLines: z.coerce
			.number()
			.describe("Number of context lines to show around matches (default: 3)")
			.optional(),
		maxMatches: z.coerce.number().describe("Maximum matches to return (default: 20)").optional(),
	}),
	async execute(params, ctx) {
		const response = await fetch(`${SERVICE_URL}/search/content`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				caseIds: params.caseIds,
				query: params.query,
				contextLines: params.contextLines || 3,
				maxMatches: params.maxMatches || 20,
			}),
			signal: ctx.abort,
		})

		if (!response.ok) {
			throw new Error(
				`CourtListener content search failed: ${response.status} ${response.statusText}`,
			)
		}

		const result = await response.json()
		const matches = result.matches || []

		if (matches.length === 0) {
			return {
				title: "No matches found",
				output: `No matches found for query: "${params.query}"`,
				metadata: {
					matchCount: 0,
					query: params.query,
				},
			}
		}

		let output = `Found ${matches.length} matches for "${params.query}":\n\n`
		for (const match of matches) {
			output += `--- Opinion ${match.opinionId} (line ${match.lineNumber}) ---\n`
			if (match.contextBefore && match.contextBefore.length > 0) {
				output += match.contextBefore.join("\n") + "\n"
			}
			output += `>>> ${match.matchText}\n`
			if (match.contextAfter && match.contextAfter.length > 0) {
				output += match.contextAfter.join("\n") + "\n"
			}
			output += "\n"
		}

		return {
			title: `${matches.length} matches found`,
			output,
			metadata: {
				matchCount: matches.length,
				query: params.query,
				matches,
			},
		}
	},
})
