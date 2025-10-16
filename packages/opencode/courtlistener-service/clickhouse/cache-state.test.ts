import { describe, it, expect, beforeEach } from 'bun:test'
import { getCacheStateManager } from './cache-state'

describe('CacheStateManager', () => {
	const manager = getCacheStateManager()

	beforeEach(() => {
		// Clean up state between tests
		manager.clearThread('test-thread-1')
		manager.clearThread('test-thread-2')
	})

	it('should register cache operations', () => {
		const promise1 = Promise.resolve()
		const promise2 = Promise.resolve()

		manager.registerCacheOperation('test-thread-1', 100, promise1)
		manager.registerCacheOperation('test-thread-1', 101, promise2)

		const operations = manager.getOperations('test-thread-1')
		expect(operations.length).toBe(2)
		expect(operations.map((op) => op.opinionId)).toContain(100)
		expect(operations.map((op) => op.opinionId)).toContain(101)
	})

	it('should track completion status', async () => {
		let resolver: () => void
		const slowPromise = new Promise<void>((resolve) => {
			resolver = resolve
		})

		manager.registerCacheOperation('test-thread-1', 100, slowPromise)

		// Initially pending
		const statusBefore = manager.getCacheStatus('test-thread-1', [100])
		expect(statusBefore.pending).toBe(1)
		expect(statusBefore.completed).toBe(0)

		// Resolve and wait
		resolver!()
		await slowPromise

		// Now completed
		const statusAfter = manager.getCacheStatus('test-thread-1', [100])
		expect(statusAfter.pending).toBe(0)
		expect(statusAfter.completed).toBe(1)
	})

	it('should isolate operations between threads', () => {
		const promise1 = Promise.resolve()
		const promise2 = Promise.resolve()

		manager.registerCacheOperation('test-thread-1', 100, promise1)
		manager.registerCacheOperation('test-thread-2', 200, promise2)

		const ops1 = manager.getOperations('test-thread-1')
		const ops2 = manager.getOperations('test-thread-2')

		expect(ops1.length).toBe(1)
		expect(ops2.length).toBe(1)
		expect(ops1[0]?.opinionId).toBe(100)
		expect(ops2[0]?.opinionId).toBe(200)
	})

	it('should wait for pending operations', async () => {
		const promises: Array<() => void> = []

		for (let i = 0; i < 5; i++) {
			const promise = new Promise<void>((resolve) => {
				promises.push(resolve)
			})
			manager.registerCacheOperation('test-thread-1', 100 + i, promise)
		}

		// Start waiting in background
		const waitPromise = manager.waitForCache('test-thread-1', [100, 101, 102, 103, 104])

		// Resolve all promises
		promises.forEach((resolve) => resolve())

		const result = await waitPromise
		expect(result.waited).toBe(5)
		expect(result.alreadyDone).toBe(0)
	})

	it('should report already completed operations', async () => {
		// Fast promises that complete immediately
		const promise1 = Promise.resolve()
		const promise2 = Promise.resolve()

		manager.registerCacheOperation('test-thread-1', 100, promise1)
		manager.registerCacheOperation('test-thread-1', 101, promise2)

		// Wait for them to complete
		await promise1
		await promise2
		await new Promise((resolve) => setTimeout(resolve, 10))

		const result = await manager.waitForCache('test-thread-1', [100, 101])
		expect(result.alreadyDone).toBeGreaterThan(0)
	})

	it('should get cache status for multiple opinions', () => {
		const fastPromise = Promise.resolve()
		let slowResolver: () => void
		const slowPromise = new Promise<void>((resolve) => {
			slowResolver = resolve
		})

		manager.registerCacheOperation('test-thread-1', 100, fastPromise)
		manager.registerCacheOperation('test-thread-1', 101, slowPromise)

		const status = manager.getCacheStatus('test-thread-1', [100, 101, 102])

		expect(status.pending).toBeGreaterThanOrEqual(1) // At least the slow one
		expect(status.notStarted).toBe(1) // Opinion 102
	})

	it('should handle empty operations', () => {
		const status = manager.getCacheStatus('empty-thread', [100, 101])
		expect(status.pending).toBe(0)
		expect(status.completed).toBe(0)
		expect(status.notStarted).toBe(2)
	})

	it('should clear thread operations', () => {
		const promise = Promise.resolve()
		manager.registerCacheOperation('test-thread-1', 100, promise)

		manager.clearThread('test-thread-1')

		const operations = manager.getOperations('test-thread-1')
		expect(operations.length).toBe(0)
	})

	it('should track operation duration', async () => {
		const promise = new Promise<void>((resolve) => setTimeout(resolve, 50))
		manager.registerCacheOperation('test-thread-1', 100, promise)

		await promise
		await new Promise((resolve) => setTimeout(resolve, 10))

		const operations = manager.getOperations('test-thread-1')
		expect(operations[0]?.durationMs).toBeGreaterThan(40)
	})
})
