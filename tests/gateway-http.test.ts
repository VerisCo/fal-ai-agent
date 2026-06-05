import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the agent so the HTTP transport can be tested without the model/network.
vi.mock('../src/agent.js', () => ({ runAgent: vi.fn() }));

import { runAgent } from '../src/agent.js';
import { signRequest } from '../src/agent-signing.js';
import { processGatewayHttpInvoke, setSigningSecret } from '../src/gateway-http.js';

const SECRET = 'shared-per-agent-secret';
const mockedRunAgent = vi.mocked(runAgent);

function signedHeaders(body: string, secret = SECRET, now = Date.now()) {
  return {
    'content-type': 'application/json',
    'x-veris-timestamp': String(now),
    'x-veris-signature': signRequest(secret, String(now), body)
  };
}

describe('gateway HTTP transport — inbound invoke', () => {
  beforeEach(() => {
    mockedRunAgent.mockReset();
    setSigningSecret(SECRET);
  });

  it('verifies the gateway signature, dispatches to runAgent, and returns a result frame', async () => {
    mockedRunAgent.mockResolvedValue({ image_url: 'https://fal.media/files/x/out.jpg' });
    const frame = { type: 'invoke.request', requestId: 'req_1', agentId: 'agent.x', contract: 'image_generation.v1', input: { message: 'a fox' } };
    const raw = JSON.stringify(frame);

    const result = await processGatewayHttpInvoke(raw, signedHeaders(raw));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      result: { contract: 'image_generation.v1', output: { image_url: 'https://fal.media/files/x/out.jpg' } }
    });

    // The frame input is handed to the agent untouched.
    expect(mockedRunAgent).toHaveBeenCalledTimes(1);
    expect(mockedRunAgent).toHaveBeenCalledWith({ message: 'a fox' });
  });

  it('rejects a bad signature with 401 and never calls the agent', async () => {
    const raw = JSON.stringify({ type: 'invoke.request', requestId: 'r', agentId: 'a', contract: 'x.v1', input: {} });
    const result = await processGatewayHttpInvoke(raw, {
      'x-veris-timestamp': String(Date.now()),
      'x-veris-signature': 'vs1=forged'
    });
    expect(result.status).toBe(401);
    expect(mockedRunAgent).not.toHaveBeenCalled();
  });

  it('maps an agent error to an ok:false envelope the gateway understands', async () => {
    mockedRunAgent.mockRejectedValue(new Error('boom'));
    const raw = JSON.stringify({ type: 'invoke.request', requestId: 'r', agentId: 'a', contract: 'x.v1', input: {} });
    const result = await processGatewayHttpInvoke(raw, signedHeaders(raw));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: false, error: { code: 'agent_error', message: 'boom' } });
  });

  it('rejects a signed-but-malformed frame with 400', async () => {
    const raw = 'not json';
    const result = await processGatewayHttpInvoke(raw, signedHeaders(raw));
    expect(result.status).toBe(400);
  });
});
