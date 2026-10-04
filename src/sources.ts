import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { SourceConfig } from './config.js';

type Active = { client: Client; transport: StdioClientTransport | StreamableHTTPClientTransport; tools: Tool[] };
export type SourceView = SourceConfig & { status: 'running' | 'stopped'; toolCount: number; error?: string };
export class SourceManager {
  private readonly active = new Map<string, Active>();
  private readonly errors = new Map<string, string>();
  constructor(private readonly configurations: () => SourceConfig[], private readonly changed: () => void) {}
  list(): SourceView[] { return this.configurations().map(source => ({ ...source, status: this.active.has(source.id) ? 'running' : 'stopped', toolCount: this.active.get(source.id)?.tools.length ?? 0, error: this.errors.get(source.id) })); }
  async start(id: string): Promise<void> {
    const source = this.configurations().find(item => item.id === id);
    if (!source) throw new Error('MCP not found');
    if (this.active.has(id)) return;
    const transport = source.transport === 'stdio'
      ? new StdioClientTransport({ command: source.command, args: source.args, env: { ...process.env, ...source.env } as Record<string, string>, stderr: 'pipe' })
      : new StreamableHTTPClientTransport(new URL(source.url));
    // Drain child stderr without writing server output or credentials to adapter logs.
    if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => {});
    const client = new Client({ name: 'myriad-adapter', version: '1.0.0' });
    try {
      await client.connect(transport);
      const tools: Tool[] = [];
      let cursor: string | undefined;
      do { const page = await client.listTools(cursor ? { cursor } : undefined); tools.push(...page.tools); cursor = page.nextCursor; } while (cursor);
      this.active.set(id, { client, transport, tools });
      this.errors.delete(id);
      client.onclose = () => { if (this.active.get(id)?.client === client) { this.active.delete(id); this.errors.set(id, 'Connection closed'); this.changed(); } };
      this.changed();
    } catch (error) {
      this.errors.set(id, error instanceof Error ? error.message : 'Connection failed');
      await client.close().catch(() => {});
      throw error;
    }
  }
  async stop(id: string): Promise<void> {
    const item = this.active.get(id);
    if (!item) return;
    this.active.delete(id);
    await item.client.close();
    this.changed();
  }
  async stopAll(): Promise<void> { await Promise.all([...this.active.keys()].map(id => this.stop(id))); }
  tools(): Array<{ sourceId: string; tool: Tool }> { return [...this.active].flatMap(([sourceId, item]) => item.tools.map(tool => ({ sourceId, tool }))); }
  async call(sourceId: string, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const item = this.active.get(sourceId);
    if (!item || !item.tools.some(tool => tool.name === name)) throw new Error('Tool unavailable');
    return await item.client.callTool({ name, arguments: args }) as CallToolResult;
  }
}

// Exact MCP names survive when unique. Ambiguous names receive stable source-ID prefixes.
export function catalog(manager: SourceManager): Array<{ name: string; sourceId: string; originalName: string; tool: Tool }> {
  const entries = manager.tools();
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.tool.name, (counts.get(entry.tool.name) ?? 0) + 1);
  return entries.map(({ sourceId, tool }) => ({ name: counts.get(tool.name) === 1 ? tool.name : `${sourceId}__${tool.name}`, sourceId, originalName: tool.name, tool }));
}
