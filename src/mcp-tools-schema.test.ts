import { expect, it, describe } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'

describe('GitChamber MCP Tools Schema Snapshots', () => {
  it('should fetch and snapshot tool schemas from preview worker /mcp', async () => {
    // Create an SSE transport to connect to the MCP server
    // The SSE endpoint is at /sse as seen in the worker code
    const transport = new SSEClientTransport(new URL('https://repo-cache-worker-preview.remorses.workers.dev/sse'))
    const client = new Client({
      name: 'gitchamber-test-client',
      version: '1.0.0'
    }, {
      capabilities: {}
    })

    try {
      // Connect to the MCP server
      await client.connect(transport)

      // List available tools
      const tools = await client.listTools()

      // Create structured data for snapshot
      const toolSchemas = {
        serverInfo: {
          // Server info is not available on the client object in this SDK version
          // We'll leave it empty for now
        },
        tools: tools.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      }

      // Use file snapshot in snapshots folder
      await expect(JSON.stringify(toolSchemas, null, 2)).toMatchFileSnapshot('./snapshots/tools-schema.json')

    } finally {
      // Clean up - close the connection
      await client.close()
    }
  }, 30000) // 30 second timeout for network request
})