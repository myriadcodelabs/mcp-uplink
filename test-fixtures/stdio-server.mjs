import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'stdio-fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'from_stdio', inputSchema: { type: 'object' } }] }));
server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: process.env['TEST_VALUE'] ?? '' }] }));
await server.connect(new StdioServerTransport());
