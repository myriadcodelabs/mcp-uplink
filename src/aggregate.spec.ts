import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SourceManager, catalog } from './sources.js';
import { handleAggregate } from './aggregate.js';
import type { SourceConfig } from './config.js';
import { fileURLToPath } from 'node:url';

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });
async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}
it('discovers HTTP tools and proxies aggregate calls end to end', async () => {
  const upstream = await listen(createServer((request, response) => {
    const server = new McpServer({ name: 'upstream', version: '1' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }] }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => ({ content: [{ type: 'text', text: String(params.arguments?.value ?? '') }] }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    response.once('close', () => { void server.close(); });
    void server.connect(transport).then(() => transport.handleRequest(request, response));
  }));
  const source: SourceConfig = { id: 'test-id', name: 'Test', transport: 'http', url: upstream };
  const manager = new SourceManager(() => [source], () => {});
  await manager.start(source.id);
  expect(catalog(manager).map(entry => entry.name)).toEqual(['echo']);
  const aggregate = await listen(createServer((request, response) => { void handleAggregate(request, response, manager); }));
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(aggregate)));
  expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['echo']);
  expect((await client.callTool({ name: 'echo', arguments: { value: 'hello' } })).content).toEqual([{ type: 'text', text: 'hello' }]);
  await client.close(); await manager.stopAll();
});

it('starts and stops a STDIO MCP with configured environment', async () => {
  const source: SourceConfig = { id: 'stdio-id', name: 'STDIO test', transport: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('../test-fixtures/stdio-server.mjs', import.meta.url))], env: { TEST_VALUE: 'from env' } };
  const manager = new SourceManager(() => [source], () => {});
  await manager.start(source.id);
  expect(manager.list()[0]?.status).toBe('running');
  expect(catalog(manager).map(entry => entry.name)).toEqual(['from_stdio']);
  expect((await manager.call(source.id, 'from_stdio', {})).content).toEqual([{ type: 'text', text: 'from env' }]);
  await manager.stop(source.id);
  expect(manager.list()[0]?.status).toBe('stopped');
});
