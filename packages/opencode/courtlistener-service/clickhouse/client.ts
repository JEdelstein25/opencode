/**
 * ClickHouse SDK client singleton with connection pooling
 */

import { createClient, type ClickHouseClient } from '@clickhouse/client'
import type { ClickHouseConfig } from './types'

let clientInstance: ClickHouseClient | null = null

export function getClickHouseClient(config?: ClickHouseConfig): ClickHouseClient {
	if (!clientInstance) {
		clientInstance = createClient({
			url: `http://${config?.host || 'localhost'}:${config?.port || 8123}`,
			username: config?.username || 'default',
			password: config?.password || '',
			database: config?.database || 'default',

			// Connection pooling
			max_open_connections: 10,
			request_timeout: 300000, // 5 min for large imports

			// Keep-alive
			keep_alive: {
				enabled: true,
				idle_socket_ttl: 2500,
			},

			// Compression
			compression: {
				request: true,
				response: true,
			},
		})
	}

	return clientInstance
}

export async function closeClient(): Promise<void> {
	if (clientInstance) {
		await clientInstance.close()
		clientInstance = null
	}
}

export async function checkClickHouseConnection(config?: ClickHouseConfig): Promise<boolean> {
	try {
		const client = getClickHouseClient(config)
		const result = await client.query({
			query: 'SELECT 1',
			format: 'JSONEachRow',
		})
		await result.json()
		return true
	} catch {
		return false
	}
}
