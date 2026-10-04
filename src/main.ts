#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve } from 'node:path';
import { ConfigStore, parseSource, type AdapterConfig } from './config.js';
import { SourceManager, catalog } from './sources.js';
import { handleAggregate } from './aggregate.js';
import { RegistryBridge, consoleAdapterLogger } from './registry-bridge.js';
import { acceptedOrigin, allowMcpOrigin, isLoopbackHost } from './local-request.js';

const store = new ConfigStore();
let config = await store.load();
const activity: Array<{ time: string; label: string; detail: string }> = [];
const log = (label: string, detail: string) => { activity.unshift({ time: new Date().toISOString(), label, detail }); activity.length = Math.min(activity.length, 30); };
let bridge: RegistryBridge | undefined;
let bridgeRun: Promise<void> | undefined;
let uplinkStatus: 'connected' | 'disconnected' = 'disconnected';
const manager = new SourceManager(() => config.sources, () => { log('TOOLS', 'Local inventory changed'); void bridge?.sync(); });
const bridgeClient = {
  listSources: async () => manager.list()
    .filter(source => source.status === 'running')
    .map(source => ({
      id: source.id,
      name: source.name,
      tools: manager.tools().filter(entry => entry.sourceId === source.id).map(entry => entry.tool),
    })),
  listTools: async () => catalog(manager).map(entry => ({ ...entry.tool, name: entry.name })),
  callTool: async (sourceId: string | undefined, name: string, args: Record<string, unknown>) => {
    if (sourceId) {
      log('TOOL CALL', `${sourceId}:${name}`);
      return manager.call(sourceId, name, args);
    }
    const entry = catalog(manager).find(item => item.name === name);
    if (!entry) throw new Error('Tool unavailable');
    log('TOOL CALL', name);
    return manager.call(entry.sourceId, entry.originalName, args);
  },
  close: async () => {},
};
async function reconnect(): Promise<void> {
  await bridge?.stop(); bridge = undefined; await bridgeRun; bridgeRun = undefined; uplinkStatus = 'disconnected';
  if (config.uplink.enabled && config.uplink.token && config.uplink.url) {
    bridge = new RegistryBridge(bridgeClient, config.uplink.url, config.uplink.token, 2000, {
      info: message => { consoleAdapterLogger.info(message); log(message.startsWith('Remote connected') ? 'REGISTER' : 'TOOLS', message); if (message.startsWith('Remote connected')) uplinkStatus = 'connected'; },
      warn: message => { consoleAdapterLogger.warn(message); uplinkStatus = 'disconnected'; log('REMOTE', message); },
      error: (message, error) => { consoleAdapterLogger.error(message, error); uplinkStatus = 'disconnected'; log('ERROR', message); },
    }, () => ({ deviceId: config.deviceId, sources: manager.list().map(({ id, name, transport, status }) => ({ id, name, transport, status })) }));
    bridgeRun = bridge.run();
  }
}
function json(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
async function body(request: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of request) { raw += chunk.toString(); if (raw.length > 1_000_000) throw new Error('Request too large'); }
  return JSON.parse(raw || '{}') as unknown;
}
const uiDir = resolve(dirname(fileURLToPath(import.meta.url)), '../ui-dist');
async function serveUi(path: string, response: ServerResponse): Promise<void> {
  const file = path === '/' || path === '/mcps' || path === '/remote' || path === '/add' ? 'index.html' : path.slice(1);
  if (file.includes('..') || file.includes('\\')) { json(response, 404, { error: 'Not found' }); return; }
  try {
    const data = await readFile(join(uiDir, file));
    response.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); response.end(data);
  } catch { json(response, 404, { error: 'UI not built. Run npm run build.' }); }
}
async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const host = request.headers.host ?? '';
  if (!isLoopbackHost(host)) { consoleAdapterLogger.warn('Rejected local request: non-loopback Host'); json(response, 403, { error: 'Loopback host required' }); return; }
  const path = new URL(request.url ?? '/', `http://${host}`).pathname;
  const isMcp = path === '/mcp';
  const origin = request.headers.origin;
  if (origin && !acceptedOrigin(origin, host, isMcp)) {
    let scheme = 'invalid';
    try { scheme = new URL(origin).protocol; } catch { /* invalid Origin */ }
    consoleAdapterLogger.warn(`Rejected ${isMcp ? '/mcp' : 'local API'} Origin scheme: ${scheme}`);
    json(response, 403, { error: 'Cross-origin request denied' }); return;
  }
  if (isMcp && origin) allowMcpOrigin(response, origin);
  if (isMcp && request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    if (path === '/mcp') { await handleAggregate(request, response, manager); return; }
    if (path === '/api/state' && request.method === 'GET') {
      json(response, 200, { sources: manager.list().map(source => source.transport === 'stdio' ? { ...source, env: Object.fromEntries(Object.keys(source.env).map(key => [key, ''])) } : source), uplink: { url: config.uplink.url, enabled: config.uplink.enabled, configured: !!config.uplink.token, status: uplinkStatus, host: (() => { try { return new URL(config.uplink.url).host; } catch { return ''; } })() }, activity, endpoint: `http://127.0.0.1:${port}/mcp`, tools: catalog(manager).length }); return;
    }
    if (path === '/api/sources' && request.method === 'POST') {
      const source = parseSource(await body(request));
      if (config.sources.some(item => item.name === source.name)) throw new Error('MCP name already exists');
      config.sources.push(source); await store.save(config); log('MCP', `${source.name} added`); json(response, 201, { id: source.id }); return;
    }
    const match = /^\/api\/sources\/([^/]+)(?:\/(start|stop|restart))?$/.exec(path);
    if (match) {
      const id = match[1]!; const action = match[2]; const index = config.sources.findIndex(item => item.id === id);
      if (index < 0) { json(response, 404, { error: 'MCP not found' }); return; }
      if (request.method === 'POST' && action) { if (action !== 'start') await manager.stop(id); if (action !== 'stop') await manager.start(id); log('MCP', `${config.sources[index]!.name} ${action}`); json(response, 200, { ok: true }); return; }
      if (request.method === 'PUT' && !action) { const next = parseSource(await body(request), id); if (next.transport === 'stdio' && config.sources[index]?.transport === 'stdio') { for (const [key, value] of Object.entries(next.env)) if (!value && config.sources[index].env[key]) next.env[key] = config.sources[index].env[key]; } if (config.sources.some(item => item.id !== id && item.name === next.name)) throw new Error('MCP name already exists'); await manager.stop(id); config.sources[index] = next; await store.save(config); json(response, 200, { ok: true }); return; }
      if (request.method === 'DELETE' && !action) { await manager.stop(id); config.sources.splice(index, 1); await store.save(config); json(response, 200, { ok: true }); return; }
    }
    if (path === '/api/uplink' && request.method === 'PUT') {
      const input = await body(request) as Record<string, unknown>;
      if (typeof input.url !== 'string' || typeof input.enabled !== 'boolean') throw new Error('Invalid uplink configuration');
      const url = new URL(input.url); if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('WebSocket URL required');
      const token = typeof input.token === 'string' && input.token ? input.token : config.uplink.token;
      if (input.enabled && !token) throw new Error('Credential required');
      config.uplink = { url: input.url, token, enabled: input.enabled }; await store.save(config); await reconnect(); json(response, 200, { ok: true }); return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') { await serveUi(path, response); return; }
    json(response, 404, { error: 'Not found' });
  } catch (error) { consoleAdapterLogger.error('Request failed', error); json(response, 400, { error: error instanceof Error ? error.message : 'Request failed' }); }
}
const port = Number(process.env['MYRIAD_ADAPTER_PORT'] ?? '8787');
const server = createServer((request, response) => { void route(request, response); });
server.listen(port, '127.0.0.1', () => consoleAdapterLogger.info(`Local adapter ready at http://127.0.0.1:${port}`));
await Promise.all(config.sources.map(source => manager.start(source.id).catch(error => consoleAdapterLogger.error(`Could not start ${source.name}`, error))));
await reconnect();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void (async () => { server.close(); await bridge?.stop(); await manager.stopAll(); })(); });
