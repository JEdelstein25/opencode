/**
 * Query utility functions for ClickHouse SDK
 */

import type { ClickHouseClient } from '@clickhouse/client'
import type { SearchFilters } from './types'

export async function getInsertProgress(
	client: ClickHouseClient,
	queryPattern: string,
): Promise<{ read_rows: number; read_bytes: number }> {
	try {
		const result = await client.query({
			query: `
        SELECT 
          read_rows,
          read_bytes,
          total_rows_approx
        FROM system.processes 
        WHERE query LIKE '%${queryPattern.substring(0, 50)}%'
        LIMIT 1
      `,
			format: 'JSONEachRow',
		})

		const data = await result.json<{ read_rows: number; read_bytes: number }>()
		return data[0] || { read_rows: 0, read_bytes: 0 }
	} catch {
		return { read_rows: 0, read_bytes: 0 }
	}
}

export async function getTableRowCount(client: ClickHouseClient, tableName: string): Promise<number> {
	try {
		const result = await client.query({
			query: `SELECT count() as cnt FROM ${tableName}`,
			format: 'JSONEachRow',
		})

		const data = await result.json<{ cnt: string }>()
		return parseInt(data[0]?.cnt || '0', 10)
	} catch {
		return 0
	}
}

export function buildWhereClause(filters: SearchFilters): string {
	const conditions: string[] = []

	if (filters.states && filters.states.length > 0) {
		const stateList = filters.states.map((s) => `'${s}'`).join(', ')
		conditions.push(`court IN (${stateList})`)
	}

	if (filters.courts && filters.courts.length > 0) {
		const courtList = filters.courts.map((c) => `'${c}'`).join(', ')
		conditions.push(`court_id IN (${courtList})`)
	}

	if (filters.dateRange && filters.dateRange.length === 2) {
		conditions.push(`date_filed >= '${filters.dateRange[0]}'`)
		conditions.push(`date_filed <= '${filters.dateRange[1]}'`)
	}

	if (filters.precedentialStatus && filters.precedentialStatus.length > 0) {
		const statusList = filters.precedentialStatus.map((s) => `'${s}'`).join(', ')
		conditions.push(`precedential_status IN (${statusList})`)
	}

	return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
}

export async function tableExists(client: ClickHouseClient, tableName: string): Promise<boolean> {
	try {
		const result = await client.query({
			query: `SELECT 1 FROM system.tables WHERE database = currentDatabase() AND name = '${tableName}' LIMIT 1`,
			format: 'JSONEachRow',
		})

		const data = await result.json()
		return data.length > 0
	} catch {
		return false
	}
}

export async function dropTable(client: ClickHouseClient, tableName: string): Promise<void> {
	await client.command({
		query: `DROP TABLE IF EXISTS ${tableName}`,
		clickhouse_settings: {
			wait_end_of_query: 1,
		},
	})
}
