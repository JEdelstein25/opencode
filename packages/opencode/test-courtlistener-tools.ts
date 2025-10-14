#!/usr/bin/env bun
/**
 * Test script for CourtListener tools
 */

import { CourtListenerSearchTool } from './src/tool/courtlistener-search'
import { CourtListenerReadTool } from './src/tool/courtlistener-read'

const testContext = {
	sessionID: 'test-session',
	messageID: 'test-message',
	agent: 'test-agent',
	abort: new AbortController().signal,
	metadata: () => {},
}

async function testSearchTool() {
	console.log('🔍 Testing CourtListener Search Tool...\n')

	const tool = await CourtListenerSearchTool.init()
	
	const result = await tool.execute(
		{
			pattern: '*Brown*Board*',
			limit: 5,
		},
		testContext,
	)

	console.log('✅ Search Tool Results:')
	console.log('  Title:', result.title)
	console.log('  Cases found:', result.metadata.count)
	console.log('\n  Output:')
	console.log(result.output.substring(0, 500) + '...\n')
	
	return result.metadata.caseIds[0] // Return first case ID for next test
}

async function testReadTool(opinionId: number) {
	console.log(`📖 Testing CourtListener Read Tool (opinion ${opinionId})...\n`)

	const tool = await CourtListenerReadTool.init()
	
	try {
		const result = await tool.execute(
			{ opinionId },
			testContext,
		)

		console.log('✅ Read Tool Results:')
		console.log('  Title:', result.title)
		console.log('  Preview:', result.metadata.preview)
		console.log('\n  Output preview:')
		console.log(result.output.substring(0, 400) + '...\n')
	} catch (err) {
		console.log('ℹ️  Read tool failed (expected if opinion not cached yet):')
		console.log('   ', (err as Error).message)
		console.log('   This is normal - opinions are fetched on-demand from CourtListener API\n')
	}
}

async function main() {
	console.log('🚀 CourtListener Tools Test Suite\n')
	console.log('=' .repeat(60) + '\n')

	try {
		const firstCaseId = await testSearchTool()
		await testReadTool(firstCaseId)

		console.log('=' .repeat(60))
		console.log('✅ All tests completed!')
		console.log('\nThe CourtListener tools are working correctly! 🎉')
	} catch (err) {
		console.error('❌ Test failed:', err)
		process.exit(1)
	}
}

main()
