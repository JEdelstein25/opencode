import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { getThreadStateManager } from './thread-state'
import { getCacheStateManager } from './cache-state'

describe('Thread State Integration', () => {
	const threadState = getThreadStateManager()
	const cacheState = getCacheStateManager()

	beforeEach(() => {
		// Clean state
		threadState.deleteThread('user-1')
		threadState.deleteThread('user-2')
		cacheState.clearThread('user-1')
		cacheState.clearThread('user-2')
	})

	afterEach(() => {
		threadState.destroy()
	})

	it('should simulate full search funnel for two users in parallel', async () => {
		// User 1: Search for CA DUI cases
		threadState.setFilters('user-1', { states: ['CA'], dateRange: ['2020-01-01', '2024-12-31'] })
		threadState.setCachedClusterIds('user-1', [1, 2, 3])

		// User 2: Search for Supreme Court cases
		threadState.setFilters('user-2', { courts: ['scotus'] })
		threadState.setCachedClusterIds('user-2', [4, 5, 6])

		// Simulate User 1 keyword search with background caching
		const user1OpinionIds = [100, 101, 102]
		threadState.setCachedOpinionIds('user-1', user1OpinionIds)

		const user1CachePromises = user1OpinionIds.map((id) => {
			const promise = new Promise<void>((resolve) => setTimeout(resolve, 10))
			cacheState.registerCacheOperation('user-1', id, promise)
			return promise
		})

		// Simulate User 2 keyword search with background caching
		const user2OpinionIds = [200, 201, 202]
		threadState.setCachedOpinionIds('user-2', user2OpinionIds)

		const user2CachePromises = user2OpinionIds.map((id) => {
			const promise = new Promise<void>((resolve) => setTimeout(resolve, 10))
			cacheState.registerCacheOperation('user-2', id, promise)
			return promise
		})

		// Both users proceed to regex search
		const user1Status = cacheState.getCacheStatus('user-1', user1OpinionIds)
		const user2Status = cacheState.getCacheStatus('user-2', user2OpinionIds)

		expect(user1Status.pending).toBeGreaterThan(0)
		expect(user2Status.pending).toBeGreaterThan(0)

		// Wait for caches
		const [user1Wait, user2Wait] = await Promise.all([
			cacheState.waitForCache('user-1', user1OpinionIds),
			cacheState.waitForCache('user-2', user2OpinionIds),
		])

		// Verify isolation
		expect(user1Wait.waited).toBe(3)
		expect(user2Wait.waited).toBe(3)

		// Verify state isolation
		expect(threadState.getFilters('user-1').states).toEqual(['CA'])
		expect(threadState.getFilters('user-2').courts).toEqual(['scotus'])
		expect(threadState.getCachedOpinionIds('user-1')).toEqual(user1OpinionIds)
		expect(threadState.getCachedOpinionIds('user-2')).toEqual(user2OpinionIds)
	})

	it('should handle user clearing state mid-search', () => {
		threadState.setFilters('user-1', { states: ['CA'] })
		threadState.setCachedClusterIds('user-1', [1, 2, 3])
		threadState.setCachedOpinionIds('user-1', [100, 101])

		// User clears state
		threadState.clearThread('user-1')
		cacheState.clearThread('user-1')

		// Verify clean state
		const thread = threadState.getThread('user-1')
		expect(thread.filters).toEqual({})
		expect(thread.cachedClusterIds).toEqual([])
		expect(thread.cachedOpinionIds).toEqual([])
		expect(cacheState.getOperations('user-1')).toEqual([])
	})

	it('should support resuming search with cached state', () => {
		// Initial search
		threadState.setFilters('user-1', { states: ['CA'] })
		threadState.setCachedClusterIds('user-1', [1, 2, 3])

		// Simulate user leaving and coming back
		const resumedFilters = threadState.getFilters('user-1')
		const resumedClusters = threadState.getCachedClusterIds('user-1')

		expect(resumedFilters.states).toEqual(['CA'])
		expect(resumedClusters).toEqual([1, 2, 3])
	})

	it('should prevent cross-contamination between concurrent searches', async () => {
		// Both users search with overlapping opinion IDs
		const sharedOpinionIds = [100, 101, 102]

		threadState.setCachedOpinionIds('user-1', sharedOpinionIds)
		threadState.setCachedOpinionIds('user-2', sharedOpinionIds)

		// Different cache promises for same opinion IDs
		const user1Promises = sharedOpinionIds.map((id) => {
			const promise = new Promise<void>((resolve) => setTimeout(() => resolve(), 20))
			cacheState.registerCacheOperation('user-1', id, promise)
			return promise
		})

		const user2Promises = sharedOpinionIds.map((id) => {
			const promise = new Promise<void>((resolve) => setTimeout(() => resolve(), 10))
			cacheState.registerCacheOperation('user-2', id, promise)
			return promise
		})

		// User 2 should complete first (shorter timeout)
		await Promise.all(user2Promises)
		const user2Status = cacheState.getCacheStatus('user-2', sharedOpinionIds)
		expect(user2Status.completed).toBe(3)

		// User 1 might still be pending
		const user1StatusDuring = cacheState.getCacheStatus('user-1', sharedOpinionIds)
		// May be pending or completed depending on timing

		// Wait for user 1 to complete
		await Promise.all(user1Promises)
		const user1StatusAfter = cacheState.getCacheStatus('user-1', sharedOpinionIds)
		expect(user1StatusAfter.completed).toBe(3)
	})

	it('should track multiple search sessions statistics', () => {
		// Create multiple threads
		for (let i = 1; i <= 5; i++) {
			threadState.getThread(`session-${i}`)
			threadState.setFilters(`session-${i}`, { states: ['CA'] })
		}

		const stats = threadState.getStats()
		expect(stats.activeThreads).toBe(5)
		expect(stats.threads.length).toBe(5)
	})

	it('should maintain thread state through full search workflow', () => {
		const threadId = 'workflow-test'

		// Step 1: Configure filters
		threadState.setFilters(threadId, { states: ['CA'], dateRange: ['2020-01-01', '2024-12-31'] })

		// Step 2: Metadata search returns cluster IDs
		const clusterIds = [1, 2, 3, 4, 5]
		threadState.setCachedClusterIds(threadId, clusterIds)

		// Verify filters persist
		expect(threadState.getFilters(threadId).states).toEqual(['CA'])

		// Step 3: Keyword search returns opinion IDs
		const opinionIds = [100, 101, 102]
		threadState.setCachedOpinionIds(threadId, opinionIds)

		// Verify all state persists
		expect(threadState.getFilters(threadId).states).toEqual(['CA'])
		expect(threadState.getCachedClusterIds(threadId)).toEqual(clusterIds)
		expect(threadState.getCachedOpinionIds(threadId)).toEqual(opinionIds)

		// Step 4: Regex search uses cached opinion IDs
		const cachedIds = threadState.getCachedOpinionIds(threadId)
		expect(cachedIds).toEqual(opinionIds)
	})
})
