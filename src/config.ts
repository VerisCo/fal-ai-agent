export const AGENT_ID = process.env.AGENT_ID || 'alphapoint.fal-image-agent';
export const AGENT_NAME = process.env.AGENT_NAME || 'fal-image-agent';
export const AGENT_DESCRIPTION = process.env.AGENT_DESCRIPTION || 'Generates images from text prompts via fal.ai and returns the image URL';
export const DEFAULT_MODEL = process.env.FAL_MODEL || 'fal-ai/flux/schnell';
export const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';
export const AGENT_CONNECT_TOKEN = process.env.AGENT_CONNECT_TOKEN || '';

export type ConnectionMode = 'http' | 'gateway' | 'both';

export const CONNECTION_MODE = parseConnectionMode(process.env.CONNECTION_MODE || 'http');
export const ENABLE_GATEWAY_CONNECTOR = CONNECTION_MODE === 'gateway' || CONNECTION_MODE === 'both';
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
// invokes and to sign outbound emit callbacks. The gateway hands it out at
// registration; set it in the env. May be filled in at runtime after an
// endpoint claim (see setSigningSecret).
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
