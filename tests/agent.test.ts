import { describe, expect, it } from 'vitest';
import { extractPrompt } from '../src/agent.js';
import { falModelEndpoint } from '../src/fal.js';
import { buildAgentConnectUrl } from '../src/gateway.js';

describe('agent input parsing', () => {
  it('reads the prompt from input.message', () => {
    expect(extractPrompt({ message: 'A watercolor fox in a snowy forest' }))
      .toBe('A watercolor fox in a snowy forest');
  });

  it('trims surrounding whitespace', () => {
    expect(extractPrompt({ message: '  a city at dusk  ' })).toBe('a city at dusk');
  });

  it('rejects a missing message', () => {
    expect(() => extractPrompt({})).toThrow('input.message is required');
  });

  it('rejects a blank message', () => {
    expect(() => extractPrompt({ message: '   ' })).toThrow('input.message is required');
  });

  it('rejects non-object input', () => {
    expect(() => extractPrompt('just a string')).toThrow('input.message is required');
  });
});

describe('gateway connection', () => {
  it('builds the outbound WebSocket URL', () => {
    expect(buildAgentConnectUrl('https://gateway.example.com', 'acme.agent', 'secret'))
      .toBe('wss://gateway.example.com/v1/agents/acme.agent/connect?token=secret');
  });
});

describe('fal endpoint resolution', () => {
  it('maps the model id onto the fal.run path', () => {
    expect(falModelEndpoint('fal-ai/flux/schnell', 'https://fal.run'))
      .toBe('https://fal.run/fal-ai/flux/schnell');
  });

  it('strips redundant slashes', () => {
    expect(falModelEndpoint('/fal-ai/flux/dev/', 'https://fal.run/'))
      .toBe('https://fal.run/fal-ai/flux/dev');
  });
});
