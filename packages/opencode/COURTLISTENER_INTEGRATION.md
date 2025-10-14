# CourtListener Integration for Opencode

Three new tool plugins have been added to enable legal opinion search via CourtListener.

## Files Added

- `src/tool/courtlistener-types.ts` - TypeScript interfaces
- `src/tool/courtlistener-search.ts` - Search cases by name/pattern
- `src/tool/courtlistener-search.txt` - Tool description
- `src/tool/courtlistener-read.ts` - Read full opinion text
- `src/tool/courtlistener-read.txt` - Tool description  
- `src/tool/courtlistener-content.ts` - Search within opinion content
- `src/tool/courtlistener-content.txt` - Tool description

## Tools Added

### courtlistener_search
Search legal cases by pattern, court, and date range.

**Parameters:**
- `pattern` (string): Glob pattern like `*Brown*Board*`
- `court` (string[], optional): Filter by court IDs like `["scotus"]`
- `dateRange` ([string, string], optional): Date range filter
- `limit` (number, optional): Max results (default: 50)

### courtlistener_read
Read the full text of a legal opinion.

**Parameters:**
- `opinionId` (number): CourtListener opinion ID

### courtlistener_content_search
Search within the text of specific opinions.

**Parameters:**
- `caseIds` (number[]): Array of case IDs to search
- `query` (string): Regex search pattern
- `contextLines` (number, optional): Context lines (default: 3)
- `maxMatches` (number, optional): Max matches (default: 20)

## Setup

Set the environment variable to point to your CourtListener Docker service:

```bash
export COURTLISTENER_SERVICE_URL=http://localhost:3000
```

Default is `http://localhost:3000`.

## Usage Example

```typescript
// Search for Supreme Court cases
await agent.useTool("courtlistener_search", {
  pattern: "*qualified immunity*",
  court: ["scotus"],
  limit: 10
})

// Read a specific opinion
await agent.useTool("courtlistener_read", {
  opinionId: 12345
})

// Search within opinions
await agent.useTool("courtlistener_content_search", {
  caseIds: [12345, 67890],
  query: "separate but equal",
  contextLines: 5
})
```

## Dependencies

Requires the CourtListener Docker service from `amp-cl-agent/core/src/external-services/courtlistener/` to be running.

## Notes

- The TypeScript errors shown in the IDE are pre-existing tsconfig issues in opencode, not related to these tools
- Tools run correctly with `bun run`
- All tools follow opencode conventions (Zod validation, Tool.define pattern)
