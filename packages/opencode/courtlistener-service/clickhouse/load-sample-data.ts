#!/usr/bin/env bun
/**
 * Download and load CourtListener sample data into ClickHouse
 * This script downloads a small sample dataset for testing
 */

import { downloadBulkDataFile, getLatestBulkDataFile } from '../download-bulk-data'
import { importToClickHouse } from './indexer'
import { getSchemaForDataset } from './schemas'
import { checkClickHouseConnection } from './client'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const DOWNLOAD_DIR = '/tmp/courtlistener-data'

async function main() {
	console.log('🔍 Checking ClickHouse connection...')
	const isConnected = await checkClickHouseConnection()

	if (!isConnected) {
		console.error('❌ ClickHouse is not running!')
		console.error('Start it with: clickhouse-server --daemon')
		process.exit(1)
	}

	console.log('✅ ClickHouse connected\n')

	// Ensure download directory exists
	if (!existsSync(DOWNLOAD_DIR)) {
		await mkdir(DOWNLOAD_DIR, { recursive: true })
	}

	// Download opinion-clusters (smallest dataset, good for testing)
	console.log('📥 Finding latest opinion-clusters bulk data...')
	const clustersFile = await getLatestBulkDataFile('opinion-clusters')

	if (!clustersFile) {
		console.error('❌ No opinion-clusters bulk data found')
		process.exit(1)
	}

	console.log(`Found: ${clustersFile}`)

	const localPath = `${DOWNLOAD_DIR}/${clustersFile}`

	if (!existsSync(localPath)) {
		console.log(`\n📥 Downloading ${clustersFile}...`)
		await downloadBulkDataFile(clustersFile, localPath, {
			onProgress: (bytes) => {
				const mb = (bytes / 1024 / 1024).toFixed(1)
				process.stdout.write(`\rDownloaded ${mb} MB...`)
			},
		})
		console.log('\n✅ Download complete!\n')
	} else {
		console.log(`✅ Using existing file: ${localPath}\n`)
	}

	// Import to ClickHouse
	console.log('📊 Importing to ClickHouse...\n')

	const result = await importToClickHouse({
		tableName: 'opinion_clusters',
		source: {
			type: 'local',
			path: localPath,
			compression: 'bz2',
		},
		createTableSQL: getSchemaForDataset('opinion_clusters'),
		onProgress: (progress) => {
			if (progress.status === 'importing') {
				const rows = (progress.rowsInserted || 0).toLocaleString()
				const bytes = formatBytes(progress.bytesProcessed || 0)
				const time = progress.elapsedSeconds?.toFixed(1) || '0.0'
				process.stdout.write(`\r⏳ Importing... ${rows} rows, ${bytes} (${time}s)`)
			} else if (progress.status === 'completed') {
				console.log(`\n✅ ${progress.message}`)
			} else if (progress.status === 'failed') {
				console.log(`\n❌ ${progress.message}`)
			} else {
				console.log(`ℹ️  ${progress.message}`)
			}
		},
	})

	if (!result.success) {
		console.error(`\n❌ Import failed: ${result.error}`)
		process.exit(1)
	}

	console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Sample data loaded successfully!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Table:    opinion_clusters
Rows:     ${result.rowsImported?.toLocaleString()}
Duration: ${result.durationSeconds?.toFixed(2)}s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Next steps:
1. Download opinions dataset (larger):
   bun download-opinions.sh

2. Test metadata search:
   bun -e "import {courtlistenerSearchMetadata} from './clickhouse'; 
   const r = await courtlistenerSearchMetadata.execute({caseNameKeywords:['Brown']}, {sessionID:'test'});
   console.log(r)"

3. Import opinions for full-text search:
   bun clickhouse/cli-import.ts /tmp/courtlistener-data/opinions-*.csv.bz2 --dataset opinions
	`)
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

main().catch((err) => {
	console.error('Fatal error:', err)
	process.exit(1)
})
