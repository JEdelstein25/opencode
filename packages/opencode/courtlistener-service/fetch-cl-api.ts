/**
 * Centralized fetch function for CourtListener API.
 * Note: CourtListener API does not require authentication.
 * Rate limit: 1000 requests per hour (returns 429 if exceeded).
 */

export interface CLAPIRequestOptions extends Pick<RequestInit, 'method' | 'cache' | 'signal'> {
	headers?: Record<string, string>
	body?: Record<string, unknown>
	params?: Record<string, string | number | boolean | undefined>
}

export interface CLAPIResponse<T = unknown> {
	data?: T
	ok: boolean
	status?: number
	statusText?: string
	headers?: Record<string, string>
}

export const COURTLISTENER_API_BASE_URL = 'https://www.courtlistener.com/api/rest/v4'

function buildCLHeaders(options: Pick<CLAPIRequestOptions, 'headers' | 'body'>): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: 'application/json',
		...options.headers,
	}

	if (options.body) {
		headers['Content-Type'] = 'application/json'
	}

	return headers
}

function buildURL(baseUrl: string, params?: Record<string, string | number | boolean | undefined>): string {
	if (!params) {
		return baseUrl
	}

	const url = new URL(baseUrl)
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) {
			url.searchParams.append(key, String(value))
		}
	}
	return url.toString()
}

export async function fetchFromCLAPI<T = unknown>(url: string, options: CLAPIRequestOptions = {}): Promise<CLAPIResponse<T>> {
	const { body, params, signal, method = 'GET', cache } = options

	const headers = buildCLHeaders({ headers: options.headers, body })
	const fullUrl = buildURL(url, params)

	try {
		const response = await fetch(fullUrl, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
			signal,
			cache,
		})

		let data: T | undefined = undefined
		if (method !== 'HEAD' && response.status !== 204) {
			const contentType = response.headers.get('content-type')
			if (contentType?.includes('application/json')) {
				try {
					data = await response.json()
				} catch (e) {
					console.warn('Failed to parse CourtListener API JSON response', e)
				}
			}
		}

		const responseHeaders: Record<string, string> = {}
		const rateLimitRemaining = response.headers.get('x-ratelimit-remaining')
		const rateLimitReset = response.headers.get('x-ratelimit-reset')
		if (rateLimitRemaining) responseHeaders['x-ratelimit-remaining'] = rateLimitRemaining
		if (rateLimitReset) responseHeaders['x-ratelimit-reset'] = rateLimitReset

		return {
			data,
			ok: response.ok,
			status: response.status,
			statusText: response.statusText,
			headers: Object.keys(responseHeaders).length > 0 ? responseHeaders : undefined,
		}
	} catch (error) {
		console.error(`CourtListener API request error (${fullUrl})`, error)
		return {
			ok: false,
			status: 0,
			statusText: error instanceof Error ? error.message : String(error),
		}
	}
}
