import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { catalog, type SourceManager } from './sources.js';

export async function handleAggregate(request: IncomingMessage, response: ServerResponse, manager: SourceManager): Promise<void> {
  const server = new Server({ name: 'mcp-uplink', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: catalog(manager).map(entry => ({ ...entry.tool, name: entry.name })) }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const entry = catalog(manager).find(item => item.name === params.name);
    if (!entry) throw new Error('Tool unavailable');
    return manager.call(entry.sourceId, entry.originalName, params.arguments ?? {});
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.once('close', () => { void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(request, response);
}
