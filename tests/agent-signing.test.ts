import { describe, expect, it } from 'vitest';
import { buildSignatureHeaders, signRequest, verifyRequest } from '../src/agent-signing.js';

const SECRET = 'per-agent-secret';

describe('agent request signing', () => {
  it('round-trips sign → verify within the skew window', () => {
    const now = 1_700_000_000_000;
    const body = JSON.stringify({ contract: 'echo.v1', input: { text: 'hi' } });
    const sig = signRequest(SECRET, String(now), body);
    expect(verifyRequest(SECRET, String(now), body, sig, { now })).toBe(true);
  });

  it('rejects a tampered body, wrong secret, stale timestamp, or missing fields', () => {
    const now = 1_700_000_000_000;
    const body = JSON.stringify({ v: 1 });
    const sig = signRequest(SECRET, String(now), body);

    expect(verifyRequest(SECRET, String(now), body + 'x', sig, { now })).toBe(false);
    expect(verifyRequest('other-secret', String(now), body, sig, { now })).toBe(false);
    expect(verifyRequest(SECRET, String(now - 10 * 60 * 1000), body, sig, { now })).toBe(false);
    expect(verifyRequest(SECRET, undefined, body, sig, { now })).toBe(false);
    expect(verifyRequest(SECRET, String(now), body, undefined, { now })).toBe(false);
    expect(verifyRequest('', String(now), body, sig, { now })).toBe(false);
  });

  it('buildSignatureHeaders produces headers the verifier accepts', () => {
    const now = 1_700_000_000_000;
    const body = '{}';
    const headers = buildSignatureHeaders(SECRET, 'agent.x', 'req_1', body, now);
    expect(headers['x-veris-agent-id']).toBe('agent.x');
    expect(headers['x-veris-request-id']).toBe('req_1');
    expect(verifyRequest(SECRET, headers['x-veris-timestamp'], body, headers['x-veris-signature'], { now })).toBe(true);
  });
});
