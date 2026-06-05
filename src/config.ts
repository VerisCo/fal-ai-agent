export const AGENT_ID = process.env.AGENT_ID || 'alphapoint.fal-image-agent';
export const AGENT_NAME = process.env.AGENT_NAME || 'fal-image-agent';
export const AGENT_DESCRIPTION = process.env.AGENT_DESCRIPTION || 'Generates images from text prompts via fal.ai and returns the image URL';
export const DEFAULT_MODEL = process.env.FAL_MODEL || 'fal-ai/flux/schnell';
export const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';
export const AGENT_CONNECT_TOKEN = process.env.AGENT_CONNECT_TOKEN || '';
export const GATEWAY_ADMIN_TOKEN = process.env.GATEWAY_ADMIN_TOKEN || '';

// Listing status to self-register as. 'active' makes the agent immediately
// invokable; use 'draft' if a human should verify it in the gateway first.
export const REGISTER_STATUS = process.env.AGENT_REGISTER_STATUS || 'active';

export type ConnectionMode = 'http' | 'gateway' | 'both';

export const CONNECTION_MODE = parseConnectionMode(process.env.CONNECTION_MODE || 'http');
export const ENABLE_GATEWAY_CONNECTOR = CONNECTION_MODE === 'gateway' || CONNECTION_MODE === 'both';
// Auto-register the manifest with the gateway on startup (first-party use).
// Self-registration is admin-authed, so this defaults on only when the agent
// actually holds GATEWAY_ADMIN_TOKEN. Third-party agents leave this off and
// connect with the per-agent AGENT_CONNECT_TOKEN the operator issued them.
export const AUTO_REGISTER = process.env.AUTO_REGISTER
  ? process.env.AUTO_REGISTER === 'true'
  : ENABLE_GATEWAY_CONNECTOR && GATEWAY_ADMIN_TOKEN !== '';
export const ENABLE_HTTP_INVOKE = process.env.ENABLE_HTTP_INVOKE
  ? process.env.ENABLE_HTTP_INVOKE === 'true'
  : CONNECTION_MODE !== 'gateway';

export type GatewayTransport = 'ws' | 'http';

// How the agent integrates with the Veris gateway when the gateway connector is
// enabled: 'ws' = dial out over WebSocket (default; works behind NAT), 'http' =
// be an addressable service the gateway POSTs to (needs a public URL).
export const GATEWAY_TRANSPORT = parseGatewayTransport(process.env.GATEWAY_TRANSPORT || 'ws');
export const ENABLE_WS_CONNECTOR = ENABLE_GATEWAY_CONNECTOR && GATEWAY_TRANSPORT === 'ws';
export const ENABLE_GATEWAY_HTTP = ENABLE_GATEWAY_CONNECTOR && GATEWAY_TRANSPORT === 'http';

// Per-agent secret for the HTTP transport — used to verify inbound gateway
// invokes and to sign outbound emit callbacks. The gateway hands it back at
// registration; set it in the env for restart robustness. May be filled in at
// runtime after self-registration (see setSigningSecret).
export const GATEWAY_SIGNING_SECRET = process.env.GATEWAY_SIGNING_SECRET || '';

// The public base URL the gateway will POST invokes to (HTTP transport only).
// Explicit AGENT_PUBLIC_URL wins; otherwise derived from Railway's injected
// domain so deploys work without hardcoding it.
export const AGENT_PUBLIC_URL = resolveAgentPublicUrl();
export const GATEWAY_INVOKE_PATH = '/gateway/invoke';
export const GATEWAY_EMIT_PATH = (agentId: string) => `/v1/agents/${encodeURIComponent(agentId)}/emit`;

function parseConnectionMode(value: string): ConnectionMode {
  if (value === 'http' || value === 'gateway' || value === 'both') {
    return value;
  }
  throw new Error(`Invalid CONNECTION_MODE "${value}". Use http, gateway, or both.`);
}

function parseGatewayTransport(value: string): GatewayTransport {
  if (value === 'ws' || value === 'http') {
    return value;
  }
  throw new Error(`Invalid GATEWAY_TRANSPORT "${value}". Use ws or http.`);
}

function resolveAgentPublicUrl(): string {
  const explicit = (process.env.AGENT_PUBLIC_URL || '').trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }
  const railwayDomain = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railwayDomain) {
    return `https://${railwayDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  }
  return '';
}

const answerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'citations', 'confidence', 'limitations'],
  properties: {
    answer: { type: 'string', minLength: 1 },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'label'],
        properties: {
          source: { type: 'string', minLength: 1 },
          label: { type: 'string', minLength: 1 }
        }
      }
    },
    confidence: { enum: ['low', 'medium', 'high'] },
    limitations: {
      type: 'array',
      items: { type: 'string' }
    }
  }
};

export function buildAgentManifest() {
  return {
    schemaVersion: 'veris.agent.marketplace.v1',
    agentId: AGENT_ID,
    name: AGENT_NAME,
    version: process.env.npm_package_version || '1.0.0',
    description: AGENT_DESCRIPTION,
    publisher: {
      name: 'Artemij Voskobojnikov'
    },
    runtime: {
      transport: ENABLE_GATEWAY_HTTP ? 'gateway_validated_http_rpc' : 'gateway_validated_ws_rpc',
      trustMode: 'gateway_validated',
      gatewayProtocol: 'veris.marketplace.gateway-rpc.v1'
    },
    marketplace: {
      visibility: process.env.AGENT_VISIBILITY || 'unlisted',
      categories: ['media'],
      tags: ['fal', 'image-generation', 'flux']
    },
    model: {
      provider: 'fal',
      defaultModel: DEFAULT_MODEL,
      apiKeyEnv: 'FAL_KEY'
    },
    capabilities: [
      {
        id: 'image_generation.v1',
        name: 'Image generation',
        description: 'Generate an image from a text prompt via fal.ai and return the hosted image URL.'
      }
    ],
    contracts: [
      {
        id: 'question_answer.v1',
        description: 'Image prompt in, hosted image URL out.',
        input: {
          contract: 'question.v1',
          description: 'A text prompt describing the image; optional context adds style/composition guidance.',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['question'],
            properties: {
              question: { type: 'string', minLength: 1 },
              context: { type: 'string' }
            }
          },
          example: {
            question: 'A watercolor fox in a snowy forest',
            context: 'soft light, muted palette'
          }
        },
        output: {
          contract: 'answer.v1',
          description: 'The generated image URL, with per-image citations and limitations.',
          schema: answerSchema,
          example: {
            answer: 'https://fal.media/files/example/output.png',
            citations: [
              { source: 'https://fal.media/files/example/output.png', label: 'Generated image 1 (fal-ai/flux/schnell)' }
            ],
            confidence: 'high',
            limitations: ['Image URLs are hosted by fal.ai and may expire — download the file to persist it.']
          }
        },
        examples: [
          {
            input: {
              question: 'A watercolor fox in a snowy forest'
            },
            output: {
              answer: 'https://fal.media/files/example/output.png',
              citations: [
                { source: 'https://fal.media/files/example/output.png', label: 'Generated image 1 (fal-ai/flux/schnell)' }
              ],
              confidence: 'high',
              limitations: ['Image URLs are hosted by fal.ai and may expire — download the file to persist it.']
            }
          }
        ]
      },
      {
        id: 'chat_answer.v1',
        description: 'Chat message with an image prompt in, hosted image URL out.',
        input: {
          contract: 'chat_message.v1',
          description: 'A chat message containing the image prompt.',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['message'],
            properties: {
              message: { type: 'string', minLength: 1 }
            }
          },
          example: {
            message: 'A retro synthwave city skyline at dusk'
          }
        },
        output: {
          contract: 'answer.v1',
          description: 'The generated image URL, with per-image citations and limitations.',
          schema: answerSchema,
          example: {
            answer: 'https://fal.media/files/example/output.png',
            citations: [
              { source: 'https://fal.media/files/example/output.png', label: 'Generated image 1 (fal-ai/flux/schnell)' }
            ],
            confidence: 'high',
            limitations: ['Image URLs are hosted by fal.ai and may expire — download the file to persist it.']
          }
        }
      }
    ],
    dataAccess: {
      description: 'Prompts are forwarded to fal.ai for image generation; no local data sources are read.',
      retention: 'The agent does not persist prompts or generated images; output files are hosted by fal.ai.'
    }
  };
}
