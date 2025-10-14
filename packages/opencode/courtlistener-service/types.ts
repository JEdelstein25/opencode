/**
 * TypeScript types for CourtListener API responses and internal data structures.
 */

export interface CaseIndexEntry {
	id: number
	name: string
	full_name: string
	court: string
	court_id: string
	date: string
	citation?: string
	judge?: string
	snippet?: string
}

export interface Opinion {
	id: number
	cluster_id: number
	case_name: string
	case_name_full: string
	type: string
	author_id?: number
	author_str?: string
	per_curiam: boolean
	joined_by_ids?: number[]
	html_with_citations?: string
	html?: string
	plain_text?: string
	xml_harvard?: string
	court: string
	court_id: string
	date_filed: string
	judges?: string[]
	citations?: string[]
	snippet?: string
	absolute_url?: string
	download_url?: string
	sha1?: string
	page_count?: number
	extracted_by_ocr?: boolean
}

export interface SearchCaseIndexOptions {
	pattern: string
	court?: string[]
	dateRange?: [string, string]
	limit?: number
	signal?: AbortSignal
}

export interface SearchOpinionContentOptions {
	contextLines?: number
	maxMatches?: number
	signal?: AbortSignal
}

export interface SearchMatch {
	opinionId: number
	lineNumber: number
	matchText: string
	contextBefore: string[]
	contextAfter: string[]
}
