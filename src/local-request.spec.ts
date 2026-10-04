import { describe, expect, it } from 'vitest';
import { acceptedOrigin, isLoopbackHost } from './local-request.js';

describe('local endpoint request boundary', () => {
  it('accepts only loopback Host values', () => {
    expect(isLoopbackHost('127.0.0.1:8787')).toBe(true);
    expect(isLoopbackHost('localhost:8787')).toBe(true);
    expect(isLoopbackHost('[::1]:8787')).toBe(true);
    expect(isLoopbackHost('evil.example:8787')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.evil.example:8787')).toBe(false);
  });
  it('accepts loopback MCP origins across ports while keeping the management API same-origin', () => {
    expect(acceptedOrigin('http://localhost:3000', '127.0.0.1:8787', true)).toBe(true);
    expect(acceptedOrigin('http://localhost:3000', '127.0.0.1:8787', false)).toBe(false);
    expect(acceptedOrigin('http://127.0.0.1:8787', '127.0.0.1:8787', false)).toBe(true);
    expect(acceptedOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop', '127.0.0.1:8787', true)).toBe(true);
    expect(acceptedOrigin('moz-extension://c4e11998-a3a2-4dfc-887a-12742ea15554', '127.0.0.1:8787', true)).toBe(true);
    expect(acceptedOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop', '127.0.0.1:8787', false)).toBe(false);
    expect(acceptedOrigin('https://evil.example', '127.0.0.1:8787', true)).toBe(false);
    expect(acceptedOrigin('null', '127.0.0.1:8787', true)).toBe(false);
  });
});
