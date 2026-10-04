import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  RegistryBridge,
  type AdapterLogger,
  type BrowserMcpClient,
} from './registry-bridge.js';

describe('RegistryBridge', () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it('registers the complete schema and forwards calls to webpage MCP', async () => {
    const tool: Tool = {
      name: 'chrome_read_page',
      description: 'Read the page',
      inputSchema: { type: 'object', properties: { depth: { type: 'number' } } },
    };
    const client = new FakeClient([{ id: 'webpage', name: 'Webpage', tools: [tool] }]);
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const logger = new RecordingLogger();
    const bridge = new RegistryBridge(
      client,
      `ws://127.0.0.1:${port}`,
      'tunnel-secret',
      10,
      logger,
    );
    closers.push(async () => {
      await bridge.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const response = new Promise<Record<string, unknown>>((resolve) => {
      server.once('connection', (socket, request) => {
        expect(request.headers.authorization).toBe('Bearer tunnel-secret');
        socket.once('message', (data) => {
          expect(JSON.parse(data.toString())).toEqual({
            type: 'register',
            sources: [{ id: 'webpage', name: 'Webpage', tools: [tool] }],
            tools: [tool],
          });
          socket.send(JSON.stringify({
            type: 'call', requestId: 'job-1', sourceId: 'webpage', name: tool.name, arguments: { depth: 2 },
          }));
          socket.once('message', (result) => resolve(JSON.parse(result.toString())));
        });
      });
    });

    void bridge.run();

    await expect(response).resolves.toEqual({
      type: 'result',
      requestId: 'job-1',
      result: { content: [{ type: 'text', text: 'page' }] },
    });
    expect(client.calls).toEqual([{ sourceId: 'webpage', name: tool.name, args: { depth: 2 } }]);
    expect(logger.infoMessages).toContain('Advertised 1 tool(s)');
    expect(logger.infoMessages).toContain('Remote connected: 127.0.0.1:' + port);
  });

  it('automatically responds to native WebSocket pings', async () => {
    const client = new FakeClient([]);
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const logger = new RecordingLogger();
    const bridge = new RegistryBridge(client, `ws://127.0.0.1:${port}`, 'tunnel-secret', 10, logger);
    closers.push(async () => {
      await bridge.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const pong = new Promise<void>((resolve) => {
      server.once('connection', (socket) => {
        socket.once('pong', () => resolve());
        socket.ping();
      });
    });

    void bridge.run();

    await pong;
  });

  it('logs a rejected WebSocket handshake without exposing URL credentials', async () => {
    const client = new FakeClient([]);
    const server = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      verifyClient: (_info, callback) => callback(false, 401, 'Unauthorized'),
    });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    const logger = new RecordingLogger();
    const rejected = new Promise<void>((resolve) => {
      logger.onError = (message) => {
        if (message.includes('handshake rejected')) resolve();
      };
    });
    const bridge = new RegistryBridge(
      client,
      `ws://user:password@127.0.0.1:${port}/adapter?token=secret`,
      'tunnel-secret',
      10,
      logger,
    );
    closers.push(async () => {
      await bridge.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const run = bridge.run();
    await rejected;
    await bridge.stop();
    await run;

    expect(logger.errorMessages).toContain(
      'Remote WebSocket handshake rejected with HTTP 401',
    );
    expect(logger.allMessages().join('\n')).not.toContain('password');
    expect(logger.allMessages().join('\n')).not.toContain('token=secret');
  });
});

class RecordingLogger implements AdapterLogger {
  readonly infoMessages: string[] = [];
  readonly warnMessages: string[] = [];
  readonly errorMessages: string[] = [];
  onError?: (message: string) => void;

  info(message: string): void {
    this.infoMessages.push(message);
  }

  warn(message: string): void {
    this.warnMessages.push(message);
  }

  error(message: string): void {
    this.errorMessages.push(message);
    this.onError?.(message);
  }

  allMessages(): string[] {
    return [...this.infoMessages, ...this.warnMessages, ...this.errorMessages];
  }
}

class FakeClient implements BrowserMcpClient {
  readonly calls: Array<{ sourceId?: string; name: string; args: Record<string, unknown> }> = [];

  constructor(private readonly sources: Array<{ id: string; name: string; tools: Tool[] }>) {}

  async listSources(): Promise<Array<{ id: string; name: string; tools: Tool[] }>> {
    return this.sources;
  }

  async listTools(): Promise<Tool[]> {
    return this.sources.flatMap(source => source.tools);
  }

  async callTool(sourceId: string | undefined, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    this.calls.push({ sourceId, name, args });
    return { content: [{ type: 'text', text: 'page' }] };
  }

  async close(): Promise<void> {}
}
