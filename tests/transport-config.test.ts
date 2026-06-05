import { afterEach, describe, expect, it, vi } from 'vitest';

// config.ts reads transport env at module load, so each case resets the module
// registry and sets env before a fresh dynamic import.
afterEach(() => {
  vi.resetModules();
  delete process.env.CONNECTION_MODE;
  delete process.env.GATEWAY_TRANSPORT;
});

describe('gateway transport selection', () => {
  it('GATEWAY_TRANSPORT=http flips the manifest runtime and enables the HTTP path', async () => {
    vi.resetModules();
    process.env.CONNECTION_MODE = 'gateway';
    process.env.GATEWAY_TRANSPORT = 'http';
    const config = await import('../src/config.js');
    expect(config.ENABLE_GATEWAY_HTTP).toBe(true);
    expect(config.ENABLE_WS_CONNECTOR).toBe(false);
    expect(config.buildAgentManifest().runtime.transport).toBe('gateway_validated_http_rpc');
  });

  it('defaults to WebSocket transport', async () => {
    vi.resetModules();
    process.env.CONNECTION_MODE = 'gateway';
    const config = await import('../src/config.js');
    expect(config.ENABLE_WS_CONNECTOR).toBe(true);
    expect(config.ENABLE_GATEWAY_HTTP).toBe(false);
    expect(config.buildAgentManifest().runtime.transport).toBe('gateway_validated_ws_rpc');
  });
});
