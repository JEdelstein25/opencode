import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { getThreadStateManager, ThreadStateManager } from './thread-state'

describe('ThreadStateManager', () => {
	let manager: ThreadStateManager

	beforeEach(() => {
		manager = ThreadStateManager.getInstance()
	})

	afterEach(() => {
		manager.destroy()
	})

	it('should create isolated state per thread', () => {
		const thread1 = manager.getThread('session-1')
		const thread2 = manager.getThread('session-2')

		expect(thread1.threadId).toBe('session-1')
		expect(thread2.threadId).toBe('session-2')
		expect(thread1).not.toBe(thread2)
	})

	it('should maintain separate filters per thread', () => {
		manager.setFilters('session-1', { states: ['CA', 'NY'] })
		manager.setFilters('session-2', { courts: ['scotus'] })

		const filters1 = manager.getFilters('session-1')
		const filters2 = manager.getFilters('session-2')

		expect(filters1.states).toEqual(['CA', 'NY'])
		expect(filters1.courts).toBeUndefined()
		expect(filters2.courts).toEqual(['scotus'])
		expect(filters2.states).toBeUndefined()
	})

	it('should update filters without overwriting', () => {
		manager.setFilters('session-1', { states: ['CA'] })
		manager.updateFilters('session-1', { courts: ['scotus'] })

		const filters = manager.getFilters('session-1')
		expect(filters.states).toEqual(['CA'])
		expect(filters.courts).toEqual(['scotus'])
	})

	it('should cache cluster IDs per thread', () => {
		manager.setCachedClusterIds('session-1', [1, 2, 3])
		manager.setCachedClusterIds('session-2', [4, 5, 6])

		expect(manager.getCachedClusterIds('session-1')).toEqual([1, 2, 3])
		expect(manager.getCachedClusterIds('session-2')).toEqual([4, 5, 6])
	})

	it('should cache opinion IDs per thread', () => {
		manager.setCachedOpinionIds('session-1', [100, 101])
		manager.setCachedOpinionIds('session-2', [200, 201])

		expect(manager.getCachedOpinionIds('session-1')).toEqual([100, 101])
		expect(manager.getCachedOpinionIds('session-2')).toEqual([200, 201])
	})

	it('should clear thread state', () => {
		manager.setFilters('session-1', { states: ['CA'] })
		manager.setCachedClusterIds('session-1', [1, 2, 3])
		manager.setCachedOpinionIds('session-1', [100, 101])

		manager.clearThread('session-1')

		const thread = manager.getThread('session-1')
		expect(thread.filters).toEqual({})
		expect(thread.cachedClusterIds).toEqual([])
		expect(thread.cachedOpinionIds).toEqual([])
	})

	it('should clear only cache while keeping filters', () => {
		manager.setFilters('session-1', { states: ['CA'] })
		manager.setCachedClusterIds('session-1', [1, 2, 3])
		manager.setCachedOpinionIds('session-1', [100, 101])

		manager.clearCache('session-1')

		const thread = manager.getThread('session-1')
		expect(thread.filters.states).toEqual(['CA'])
		expect(thread.cachedClusterIds).toEqual([])
		expect(thread.cachedOpinionIds).toEqual([])
	})

	it('should delete thread completely', () => {
		manager.setFilters('session-1', { states: ['CA'] })
		expect(manager.getActiveThreadIds()).toContain('session-1')

		manager.deleteThread('session-1')
		expect(manager.getActiveThreadIds()).not.toContain('session-1')
	})

	it('should return singleton instance', () => {
		const instance1 = getThreadStateManager()
		const instance2 = getThreadStateManager()
		expect(instance1).toBe(instance2)
	})

	it('should track active threads', () => {
		manager.getThread('session-1')
		manager.getThread('session-2')
		manager.getThread('session-3')

		const activeIds = manager.getActiveThreadIds()
		expect(activeIds).toContain('session-1')
		expect(activeIds).toContain('session-2')
		expect(activeIds).toContain('session-3')
		expect(activeIds.length).toBe(3)
	})

	it('should provide thread statistics', () => {
		manager.getThread('session-1')
		manager.getThread('session-2')

		const stats = manager.getStats()
		expect(stats.activeThreads).toBe(2)
		expect(stats.maxThreads).toBe(1000)
		expect(stats.threadTTL).toBe(3600000)
		expect(stats.threads).toContain('session-1')
		expect(stats.threads).toContain('session-2')
	})

	it('should update lastActivity timestamp on access', async () => {
		const thread1 = manager.getThread('session-1')
		const time1 = thread1.lastActivity

		await new Promise((resolve) => setTimeout(resolve, 10))

		const thread2 = manager.getThread('session-1')
		const time2 = thread2.lastActivity

		expect(time2).toBeGreaterThan(time1)
	})

	it('should handle empty state gracefully', () => {
		const filters = manager.getFilters('non-existent')
		const clusterIds = manager.getCachedClusterIds('non-existent')
		const opinionIds = manager.getCachedOpinionIds('non-existent')

		expect(filters).toEqual({})
		expect(clusterIds).toEqual([])
		expect(opinionIds).toEqual([])
	})
})
