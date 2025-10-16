/**
 * Tests for ClickHouse indexer
 */

import { describe, expect, it } from 'bun:test'
import { detectCompressionFormat, formatBytes } from './clickhouse-indexer'

describe('ClickHouse Indexer', () => {
	describe('detectCompressionFormat', () => {
		it('should detect bz2 compression', () => {
			expect(detectCompressionFormat('file.csv.bz2')).toBe('bz2')
			expect(detectCompressionFormat('/path/to/opinion-clusters.csv.bz2')).toBe('bz2')
		})

		it('should detect gz compression', () => {
			expect(detectCompressionFormat('file.csv.gz')).toBe('gz')
			expect(detectCompressionFormat('FILE.CSV.GZ')).toBe('gz')
		})

		it('should detect xz compression', () => {
			expect(detectCompressionFormat('file.csv.xz')).toBe('xz')
		})

		it('should detect zstd compression', () => {
			expect(detectCompressionFormat('file.csv.zst')).toBe('zstd')
			expect(detectCompressionFormat('file.csv.zstd')).toBe('zstd')
		})

		it('should return none for uncompressed files', () => {
			expect(detectCompressionFormat('file.csv')).toBe('none')
			expect(detectCompressionFormat('file.txt')).toBe('none')
		})
	})

	describe('formatBytes', () => {
		it('should format bytes correctly', () => {
			expect(formatBytes(100)).toBe('100 B')
			expect(formatBytes(1024)).toBe('1.00 KB')
			expect(formatBytes(1024 * 1024)).toBe('1.00 MB')
			expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB')
			expect(formatBytes(2.3 * 1024 * 1024 * 1024)).toBe('2.30 GB')
		})
	})
})
