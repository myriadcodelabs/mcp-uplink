import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';

export interface BrowserMcpClient {
  listSources(): Promise<Array<{ id: string; name: string; tools: Tool[] }>>;
  listTools(): Promise<Tool[]>;
  callTool(sourceId: string | undefined, name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}
export interface AdapterLogger { info(message: string): void; warn(message: string): void; error(message: string, error?: unknown): void }
export const consoleAdapterLogger: AdapterLogger = {
  info: message => console.info(`[myriad-adapter] ${message}`),
  warn: message => console.warn(`[myriad-adapter] ${message}`),
  error: (message, error) => console.error(`[myriad-adapter] ${message}${error === undefined ? '' : `: ${error instanceof Error ? error.message : 'Unknown error'}`}`),
};

export class RegistryBridge {
  private stopped = false;
  private socket?: WebSocket;
  private wake?: () => void;
  private readonly safeHost: string;
  constructor(private readonly client: BrowserMcpClient, private readonly url: string, private readonly token: string, private readonly retryDelayMs = 1000, private readonly logger: AdapterLogger = consoleAdapterLogger, private readonly inventory: () => object = () => ({})) {
    try { this.safeHost = new URL(url).host; } catch { this.safeHost = '<invalid URL>'; }
  }
  async run(): Promise<void> {
    while (!this.stopped) {
      try { await this.connectOnce(); } catch (error) { this.logger.error(`Remote connection failed for ${this.safeHost}`); }
      if (!this.stopped) await new Promise<void>(resolve => { const timer = setTimeout(resolve, this.retryDelayMs); this.wake = () => { clearTimeout(timer); resolve(); }; });
    }
  }
  async stop(): Promise<void> { this.stopped = true; this.wake?.(); this.socket?.terminate(); await this.client.close(); }
  async sync(): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const [sources, tools] = await Promise.all([this.client.listSources(), this.client.listTools()]);
    this.socket.send(JSON.stringify({ type: 'register', ...this.inventory(), sources, tools }));
    this.logger.info(`Advertised ${tools.length} tool(s)`);
  }
  private connectOnce(): Promise<void> {
    return new Promise(resolve => {
      let socket: WebSocket;
      try { socket = new WebSocket(this.url, { headers: { Authorization: `Bearer ${this.token}` } }); }
      catch (error) { this.logger.error('Invalid remote WebSocket configuration'); resolve(); return; }
      this.socket = socket;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      socket.once('open', () => {
        this.logger.info(`Remote connected: ${this.safeHost}`);
        void this.sync().catch(error => this.logger.error('Tool registration failed', error));
      });
      socket.on('message', data => { void this.handle(socket, data.toString()); });
      socket.once('close', (code) => { this.logger.warn(`Remote disconnected (${code})`); finish(); });
      socket.once('error', error => { this.logger.error('Remote WebSocket error'); finish(); });
      socket.once('unexpected-response', (_request, response) => { this.logger.error(`Remote WebSocket handshake rejected with HTTP ${response.statusCode ?? 'unknown'}`); response.resume(); socket.terminate(); finish(); });
    });
  }
  private async handle(socket: WebSocket, payload: string): Promise<void> {
    let requestId: string | undefined;
    try {
      const frame = JSON.parse(payload) as { type?: unknown; requestId?: unknown; sourceId?: unknown; name?: unknown; arguments?: unknown };
      if (frame.type !== 'call' || typeof frame.requestId !== 'string' || typeof frame.name !== 'string' || !frame.name) return;
      if (frame.sourceId !== undefined && (typeof frame.sourceId !== 'string' || !frame.sourceId)) return;
      requestId = frame.requestId;
      const args = frame.arguments && typeof frame.arguments === 'object' && !Array.isArray(frame.arguments) ? frame.arguments as Record<string, unknown> : {};
      const result = await this.client.callTool(frame.sourceId as string | undefined, frame.name, args);
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'result', requestId, result }));
    } catch (error) {
      this.logger.error(`Remote call failed${requestId ? ` for ${requestId}` : ''}`, error);
      if (requestId && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'error', requestId, message: error instanceof Error ? error.message : 'Tool call failed' }));
    }
  }
}
