import { describe, expect, it } from 'vitest';
import { extractPrompt } from '../src/agent.js';
import { buildAgentManifest } from '../src/config.js';
import { falModelEndpoint } from '../src/fal.js';
import { buildAgentConnectUrl } from '../src/gateway.js';

describe('agent request parsing', () => {
  it('accepts question.v1 input and folds context into the prompt', () => {
    const prompt = extractPrompt({
      input: {
        contract: 'question.v1',
        data: {
          question: 'A watercolor fox in a snowy forest',
          context: 'soft light, muted palette'
        }
      }
    });

    expect(prompt).toBe('A watercolor fox in a snowy forest, soft light, muted palette');
  });

  it('accepts chat_message.v1 input', () => {
    const prompt = extractPrompt({
      input: {
        contract: 'chat_message.v1',
        data: {
          message: 'A retro synthwave city skyline at dusk'
        }
      }
    });

    expect(prompt).toBe('A retro synthwave city skyline at dusk');
  });

  it('rejects unsupported contracts', () => {
    expect(() => extractPrompt({
      input: {
        contract: 'unknown.v1',
        data: {}
      }
    })).toThrow('Unsupported input contract');
  });
});

describe('marketplace gateway manifest', () => {
  it('declares gateway-validated contracts', () => {
    const manifest = buildAgentManifest();

    expect(manifest.schemaVersion).toBe('veris.agent.marketplace.v1');
    expect(manifest.runtime.transport).toBe('gateway_validated_ws_rpc');
    expect(manifest.runtime.trustMode).toBe('gateway_validated');
    expect(manifest.contracts.map((contract) => contract.id)).toContain('question_answer.v1');
    expect(manifest.contracts[0].output.contract).toBe('answer.v1');
  });

  it('declares the fal model provider', () => {
    const manifest = buildAgentManifest();

    expect(manifest.model.provider).toBe('fal');
    expect(manifest.model.apiKeyEnv).toBe('FAL_KEY');
    expect(manifest.capabilities.map((capability) => capability.id)).toContain('image_generation.v1');
  });

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
