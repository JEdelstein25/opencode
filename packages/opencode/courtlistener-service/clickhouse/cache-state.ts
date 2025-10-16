/**
 * Background cache state manager for tracking opinion caching operations.
 * Allows fire-and-forget caching while later tools can check completion status.
 */

interface CacheOperation {
	opinionId: number
	promise: Promise<void>
	startedAt: number
	completed: boolean
}

interface ThreadCacheState {
	operations: Map<number, CacheOperation>
}

class CacheStateManager {
	private static instance: CacheStateManager | null = null
	private threads = new Map<string, ThreadCacheState>()

	private constructor() {}

	static getInstance(): CacheStateManager {
		if (!CacheStateManager.instance) {
			CacheStateManager.instance = new CacheStateManager()
		}
		return CacheStateManager.instance
	}

	/**
	 * Get or create cache state for a thread
	 */
	private getThreadState(threadId: string): ThreadCacheState {
		let state = this.threads.get(threadId)
		if (!state) {
			state = { operations: new Map() }
			this.threads.set(threadId, state)
		}
		return state
	}

	/**
	 * Register a background cache operation
	 */
	registerCacheOperation(threadId: string, opinionId: number, promise: Promise<void>): void {
		const state = this.getThreadState(threadId)
		const operation: CacheOperation = {
			opinionId,
			promise: promise.finally(() => {
				operation.completed = true
			}),
			startedAt: Date.now(),
			completed: false,
		}
		state.operations.set(opinionId, operation)
	}

	/**
	 * Wait for specific opinion IDs to be cached (if operations are in progress)
	 */
	async waitForCache(threadId: string, opinionIds: number[]): Promise<{ waited: number; alreadyDone: number }> {
		const state = this.getThreadState(threadId)
		const pendingOperations: Promise<void>[] = []
		let alreadyDone = 0

		for (const opinionId of opinionIds) {
			const operation = state.operations.get(opinionId)
			if (operation) {
				if (operation.completed) {
					alreadyDone++
				} else {
					pendingOperations.push(operation.promise)
				}
			}
		}

		if (pendingOperations.length > 0) {
			await Promise.allSettled(pendingOperations)
		}

		return {
			waited: pendingOperations.length,
			alreadyDone,
		}
	}

	/**
	 * Check if cache operations are in progress for given opinion IDs
	 */
	getCacheStatus(threadId: string, opinionIds: number[]): { pending: number; completed: number; notStarted: number } {
		const state = this.getThreadState(threadId)
		let pending = 0
		let completed = 0
		let notStarted = 0

		for (const opinionId of opinionIds) {
			const operation = state.operations.get(opinionId)
			if (!operation) {
				notStarted++
			} else if (operation.completed) {
				completed++
			} else {
				pending++
			}
		}

		return { pending, completed, notStarted }
	}

	/**
	 * Clear cache state for a thread
	 */
	clearThread(threadId: string): void {
		this.threads.delete(threadId)
	}

	/**
	 * Get all operations for debugging
	 */
	getOperations(threadId: string): Array<{ opinionId: number; completed: boolean; durationMs: number }> {
		const state = this.threads.get(threadId)
		if (!state) return []

		const now = Date.now()
		return Array.from(state.operations.values()).map((op) => ({
			opinionId: op.opinionId,
			completed: op.completed,
			durationMs: now - op.startedAt,
		}))
	}
}

export function getCacheStateManager(): CacheStateManager {
	return CacheStateManager.getInstance()
}
