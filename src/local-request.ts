import type { IncomingMessage, ServerResponse } from 'node:http';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLoopbackHost(host: string): boolean {
  try {
    const parsed = new URL(`http://${host}`);
    return loopbackHosts.has(parsed.hostname) && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash;
  } catch { return false; }
}

export function acceptedOrigin(origin: string, host: string, isMcp: boolean): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.username || parsed.password || !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash) return false;
    if (isMcp && ['chrome-extension:', 'moz-extension:'].includes(parsed.protocol)) return !!parsed.hostname && !parsed.port;
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return isMcp ? loopbackHosts.has(parsed.hostname) : parsed.host === host;
  } catch { return false; }
}

export function allowMcpOrigin(response: ServerResponse, origin: string): void {
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
  response.setHeader('access-control-expose-headers', 'Mcp-Session-Id, Mcp-Protocol-Version');
}
