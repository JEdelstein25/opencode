import z from "zod/v4"
import { Tool } from "./tool"
import type { CaseSearchResult } from "./courtlistener-types"

const SERVICE_URL = process.env.COURTLISTENER_SERVICE_URL || "http://localhost:3000"

const DESCRIPTION = `Search legal opinions from CourtListener by case name.

This tool searches the CourtListener database for legal cases matching a pattern. It returns case IDs and metadata that can be used with the courtlistener_read tool to fetch full opinions.

Examples:
- Search for Supreme Court cases: pattern="*", court=["scotus"]
- Search for specific case: pattern="*Brown*Board*Education*"
- Search with date range: pattern="*qualified immunity*", dateRange=["2020-01-01", "2024-12-31"]

The pattern parameter uses glob syntax (* for wildcards).`

export const CourtListenerSearchTool = Tool.define("courtlistener_search", {
	description: DESCRIPTION,
	parameters: z.object({
		pattern: z.string().describe("Glob pattern to search case names (e.g., '*Brown*Board*')"),
		court: z
			.array(z.string())
			.describe("Filter by court IDs (e.g., ['scotus', 'ca9'])")
			.optional(),
		dateRange: z
			.tuple([z.string(), z.string()])
			.describe("Filter by date range [start, end] in YYYY-MM-DD format")
			.optional(),
		limit: z.coerce.number().describe("Maximum number of results (default: 50)").optional(),
	}),
	async execute(params, ctx) {
		const response = await fetch(`${SERVICE_URL}/search/cases`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				pattern: params.pattern,
				limit: params.limit || 50,
				court: params.court,
				dateRange: params.dateRange,
			}),
			signal: ctx.abort,
		})

		if (!response.ok) {
			throw new Error(
				`CourtListener search failed: ${response.status} ${response.statusText}`,
			)
		}

		const result = await response.json()
		const caseIds: number[] = result.caseIds || []
		const cases = result.cases as CaseSearchResult[]

		let output = ""
		if (caseIds.length === 0) {
			output = `No cases found matching pattern: ${params.pattern}`
		} else {
			output = `Found ${caseIds.length} cases:\n\n`
			for (const c of cases.slice(0, 20)) {
				output += `[${c.id}] ${c.name}\n`
				output += `  Court: ${c.court} | Date: ${c.date}\n`
				if (c.citation) {
					output += `  Citation: ${c.citation}\n`
				}
				output += "\n"
			}

			if (caseIds.length > 20) {
				output += `\n... and ${caseIds.length - 20} more cases\n`
			}

			output += `\nUse courtlistener_read tool with case IDs to read full opinions.`
		}

		return {
			title: caseIds.length === 0 ? "No cases found" : `Found ${caseIds.length} cases`,
			output,
			metadata: {
				count: caseIds.length,
				caseIds: caseIds as any,
				cases: cases as any,
			},
		}
	},
})
