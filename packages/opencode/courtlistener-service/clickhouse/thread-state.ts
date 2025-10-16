/**
 * Thread-level state manager for CourtListener search sessions.
 * Maintains search filters and cached results per conversation thread.
 * Each thread (sessionID) has isolated state to prevent cross-conversation leakage.
 */

import type { SearchFilters } from './types'

export interface ThreadState {
	/** Unique thread/session identifier */
	threadId: string

	/** Active search filters for this thread */
	filters: SearchFilters

	/** Cached cluster IDs from last metadata search */
	cachedClusterIds: number[]

	/** Cached opinion IDs from last keyword search */
	cachedOpinionIds: number[]

	/** Timestamp of last activity */
	lastActivity: number
}

/**
 * Manages search state across multiple tool calls within a conversation thread.
 * Each thread (conversation/session) maintains its own independent state.
 */
export class ThreadStateManager {
	private static instance: ThreadStateManager | null = null
	private threads = new Map<string, ThreadState>()
	private readonly MAX_THREADS = 1000
	private readonly CLEANUP_INTERVAL_MS = 60000 // 1 minute
	private readonly THREAD_TTL_MS = 3600000 // 1 hour
	private cleanupTimer: NodeJS.Timeout | null = null

	private constructor() {
		this.startCleanup()
	}

	/**
	 * Get the singleton instance
	 */
	static getInstance(): ThreadStateManager {
		if (!ThreadStateManager.instance) {
			ThreadStateManager.instance = new ThreadStateManager()
		}
		return ThreadStateManager.instance
	}

	/**
	 * Get or create thread state for a conversation
	 */
	getThread(threadId: string): ThreadState {
		let thread = this.threads.get(threadId)

		if (!thread) {
			thread = {
				threadId,
				filters: {},
				cachedClusterIds: [],
				cachedOpinionIds: [],
				lastActivity: Date.now(),
			}
			this.threads.set(threadId, thread)

			// Evict old threads if we exceed max
			if (this.threads.size > this.MAX_THREADS) {
				this.evictOldestThreads()
			}
		} else {
			// Update last activity timestamp
			thread.lastActivity = Date.now()
		}

		return thread
	}

	/**
	 * Update search filters for a thread
	 */
	setFilters(threadId: string, filters: SearchFilters): void {
		const thread = this.getThread(threadId)
		thread.filters = { ...filters }
	}

	/**
	 * Get active filters for a thread
	 */
	getFilters(threadId: string): SearchFilters {
		return this.getThread(threadId).filters
	}

	/**
	 * Update filters (merge with existing)
	 */
	updateFilters(threadId: string, partialFilters: Partial<SearchFilters>): void {
		const thread = this.getThread(threadId)
		thread.filters = { ...thread.filters, ...partialFilters }
	}

	/**
	 * Cache cluster IDs from metadata search
	 */
	setCachedClusterIds(threadId: string, clusterIds: number[]): void {
		const thread = this.getThread(threadId)
		thread.cachedClusterIds = clusterIds
	}

	/**
	 * Get cached cluster IDs for a thread
	 */
	getCachedClusterIds(threadId: string): number[] {
		return this.getThread(threadId).cachedClusterIds
	}

	/**
	 * Cache opinion IDs from keyword search
	 */
	setCachedOpinionIds(threadId: string, opinionIds: number[]): void {
		const thread = this.getThread(threadId)
		thread.cachedOpinionIds = opinionIds
	}

	/**
	 * Get cached opinion IDs for a thread
	 */
	getCachedOpinionIds(threadId: string): number[] {
		return this.getThread(threadId).cachedOpinionIds
	}

	/**
	 * Clear all state for a thread (filters + cache)
	 */
	clearThread(threadId: string): void {
		const thread = this.getThread(threadId)
		thread.filters = {}
		thread.cachedClusterIds = []
		thread.cachedOpinionIds = []
	}

	/**
	 * Clear only cache (keep filters)
	 */
	clearCache(threadId: string): void {
		const thread = this.getThread(threadId)
		thread.cachedClusterIds = []
		thread.cachedOpinionIds = []
	}

	/**
	 * Delete a thread completely
	 */
	deleteThread(threadId: string): void {
		this.threads.delete(threadId)
	}

	/**
	 * Get all active thread IDs
	 */
	getActiveThreadIds(): string[] {
		return Array.from(this.threads.keys())
	}

	/**
	 * Get thread statistics
	 */
	getStats() {
		return {
			activeThreads: this.threads.size,
			maxThreads: this.MAX_THREADS,
			threadTTL: this.THREAD_TTL_MS,
			threads: this.getActiveThreadIds(),
		}
	}

	/**
	 * Evict oldest threads when exceeding max
	 */
	private evictOldestThreads(): void {
		const threads = Array.from(this.threads.entries()).sort(([, a], [, b]) => a.lastActivity - b.lastActivity)

		const toRemove = Math.floor(this.MAX_THREADS * 0.1) // Remove 10%
		for (let i = 0; i < toRemove && i < threads.length; i++) {
			this.threads.delete(threads[i]![0])
		}
	}

	/**
	 * Clean up stale threads periodically
	 */
	private startCleanup(): void {
		this.cleanupTimer = setInterval(() => {
			const now = Date.now()
			const staleThreads: string[] = []

			for (const [threadId, thread] of this.threads.entries()) {
				if (now - thread.lastActivity > this.THREAD_TTL_MS) {
					staleThreads.push(threadId)
				}
			}

			for (const threadId of staleThreads) {
				this.threads.delete(threadId)
			}

			if (staleThreads.length > 0) {
				console.log(`[ThreadStateManager] Cleaned up ${staleThreads.length} stale threads`)
			}
		}, this.CLEANUP_INTERVAL_MS)

		// Prevent timer from keeping process alive
		if (this.cleanupTimer.unref) {
			this.cleanupTimer.unref()
		}
	}

	/**
	 * Stop cleanup timer (for testing)
	 */
	destroy(): void {
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer)
			this.cleanupTimer = null
		}
		this.threads.clear()
		ThreadStateManager.instance = null
	}
}

/**
 * Get the global thread state manager instance
 */
export function getThreadStateManager(): ThreadStateManager {
	return ThreadStateManager.getInstance()
}
