import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type SourceConfig = { id: string; name: string; description?: string; transport: 'stdio'; command: string; args: string[]; env: Record<string, string> } | { id: string; name: string; description?: string; transport: 'http'; url: string };
export type UplinkConfig = { url: string; token: string; enabled: boolean };
export type AdapterConfig = { deviceId: string; sources: SourceConfig[]; uplink: UplinkConfig };

export class ConfigStore {
  constructor(readonly path = process.env['MYRIAD_ADAPTER_CONFIG'] ?? join(homedir(), '.config', 'myriad-adapter', 'config.json')) {}
  async load(): Promise<AdapterConfig> {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8')) as AdapterConfig;
      if (!Array.isArray(data.sources) || !data.uplink || typeof data.deviceId !== 'string') throw new Error('Invalid config file');
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const data: AdapterConfig = { deviceId: randomUUID(), sources: [], uplink: { url: 'wss://api-mcp.myriadcode.com/adapter', token: '', enabled: false } };
      await this.save(data);
      return data;
    }
  }
  async save(data: AdapterConfig): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    await rename(temp, this.path);
  }
}

export function parseSource(value: unknown, id: string = randomUUID()): SourceConfig {
  if (!value || typeof value !== 'object') throw new Error('Invalid MCP configuration');
  const input = value as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100) throw new Error('Name is required (maximum 100 characters)');
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 300) : undefined;
  if (input.transport === 'stdio') {
    const command = typeof input.command === 'string' ? input.command.trim() : '';
    if (!command || command.includes('\0')) throw new Error('Command is required');
    if (!Array.isArray(input.args) || !input.args.every(arg => typeof arg === 'string')) throw new Error('Arguments must be an array of strings');
    const env = input.env ?? {};
    if (typeof env !== 'object' || env === null || Array.isArray(env) || !Object.entries(env).every(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string')) throw new Error('Environment variables must be string pairs');
    return { id, name, description, transport: 'stdio', command, args: input.args as string[], env: env as Record<string, string> };
  }
  if (input.transport === 'http') {
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('Valid HTTP MCP URL is required'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('HTTP MCP URL must use http or https');
    return { id, name, description, transport: 'http', url };
  }
  throw new Error('Transport must be stdio or http');
}
