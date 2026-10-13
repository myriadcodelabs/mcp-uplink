import { expect, it } from 'vitest';
import { parseSource } from './config.js';

it('parses HTTP MCP headers', () => {
  expect(parseSource({ name: 'Secured', transport: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token', 'X-API-Key': 'key' } }, 'id')).toEqual({
    id: 'id',
    name: 'Secured',
    description: undefined,
    transport: 'http',
    url: 'https://example.com/mcp',
    headers: { Authorization: 'Bearer token', 'X-API-Key': 'key' },
  });
});

it('rejects unsafe HTTP header values', () => {
  expect(() => parseSource({ name: 'Bad', transport: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer token\r\nX-Evil: yes' } }, 'id')).toThrow('HTTP headers must be valid string pairs');
});
