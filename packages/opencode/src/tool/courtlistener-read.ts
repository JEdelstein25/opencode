import z from "zod/v4"
import { Tool } from "./tool"
import type { Opinion } from "./courtlistener-types"

const SERVICE_URL = process.env.COURTLISTENER_SERVICE_URL || "http://localhost:3000"

const DESCRIPTION = `Read the full text of a legal opinion from CourtListener.

This tool fetches and displays the complete text of a legal opinion given its CourtListener ID. The opinion includes metadata (court, date, judges, citations) and the full opinion text.

Use this tool after using courtlistener_search to get the IDs of cases you want to read.

Example: opinionId: 12345`

export const CourtListenerReadTool = Tool.define("courtlistener_read", {
	description: DESCRIPTION,
	parameters: z.object({
		opinionId: z.coerce.number().describe("The CourtListener opinion ID to fetch"),
	}),
	async execute(params, ctx) {
		const response = await fetch(`${SERVICE_URL}/api/opinions/${params.opinionId}`, {
			signal: ctx.abort,
		})

		if (response.status === 404) {
			throw new Error(`Opinion ${params.opinionId} not found`)
		}

		if (!response.ok) {
			throw new Error(
				`CourtListener API error: ${response.status} ${response.statusText}`,
			)
		}

		const opinion: Opinion = await response.json()

		const title = opinion.case_name || `Opinion ${params.opinionId}`
		let output = `# ${opinion.case_name_full || opinion.case_name}\n\n`
		output += `**Court:** ${opinion.court}\n`
		output += `**Date Filed:** ${opinion.date_filed}\n`
		output += `**Type:** ${opinion.type}\n`

		if (opinion.author_str) {
			output += `**Author:** ${opinion.author_str}\n`
		}

		if (opinion.citations && opinion.citations.length > 0) {
			output += `**Citations:** ${opinion.citations.join(", ")}\n`
		}

		if (opinion.judges && opinion.judges.length > 0) {
			output += `**Judges:** ${opinion.judges.join(", ")}\n`
		}

		output += "\n---\n\n"

		const text =
			opinion.html_with_citations || opinion.plain_text || opinion.html || ""
		if (text) {
			output += text
		} else {
			output += "(No opinion text available)"
		}

		const preview = `${opinion.case_name} (${opinion.court}, ${opinion.date_filed})`

		return {
			title,
			output,
			metadata: {
				preview,
				opinionId: opinion.id,
				court: opinion.court,
				date: opinion.date_filed,
			},
		}
	},
})
