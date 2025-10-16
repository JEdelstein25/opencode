import { describe, it, expect } from 'bun:test'
import { getClickHouseClient, checkClickHouseConnection, closeClient } from './client'

describe('ClickHouse Client', () => {
	it('should create a singleton client', () => {
		const client1 = getClickHouseClient()
		const client2 = getClickHouseClient()
		expect(client1).toBe(client2)
	})

	it('should check connection health', async () => {
		const isHealthy = await checkClickHouseConnection()
		expect(typeof isHealthy).toBe('boolean')
	})

	it('should close client cleanly', async () => {
		await closeClient()
		// After close, next call should create new instance
		const newClient = getClickHouseClient()
		expect(newClient).toBeDefined()
	})
})
