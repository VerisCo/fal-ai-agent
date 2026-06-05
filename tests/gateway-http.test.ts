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
    mockedRunAgent.mockResolvedValue({ output: { contract: 'answer.v1', data: { answer: 'hi' } }, usage: { totalTokens: 3 } });
    const frame = { type: 'invoke.request', requestId: 'req_1', agentId: 'agent.x', contract: 'question_answer.v1', input: { question: 'hi' } };
    const raw = JSON.stringify(frame);

    const result = await processGatewayHttpInvoke(raw, signedHeaders(raw));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ result: { contract: 'answer.v1', output: { answer: 'hi' }, usage: { totalTokens: 3 } } });

    // The gateway contract was mapped to the agent's input envelope.
    expect(mockedRunAgent).toHaveBeenCalledTimes(1);
    const passed = mockedRunAgent.mock.calls[0][0];
    expect(passed.input.contract).toBe('question.v1');
    expect(passed.metadata).toBeUndefined();
  });

  it('passes a custom contract through unchanged and forwards delivery context', async () => {
    mockedRunAgent.mockResolvedValue({ output: { contract: 'reminder_ack.v1', data: { ok: true } } });
    const frame = { type: 'invoke.request', requestId: 'req_2', agentId: 'agent.x', contract: 'set_reminder.v1', input: { request: 'in 5m ping' }, context: { delivery: 'vd1.abc.def' } };
    const raw = JSON.stringify(frame);

    const result = await processGatewayHttpInvoke(raw, signedHeaders(raw));
    expect(result.status).toBe(200);
    const passed = mockedRunAgent.mock.calls[0][0];
    expect(passed.input.contract).toBe('set_reminder.v1');
    expect(passed.metadata).toEqual({ delivery: 'vd1.abc.def' });
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
