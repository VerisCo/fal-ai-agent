import {
  AGENT_CONNECT_TOKEN,
  AGENT_ID,
  AGENT_PUBLIC_URL,
  ENABLE_GATEWAY_HTTP,
  GATEWAY_INVOKE_PATH,
  GATEWAY_URL
} from './config.js';

interface ClaimOptions {
  gatewayUrl?: string;
  connectToken?: string;
  attempts?: number;
}

export interface ClaimResult {
  registered: boolean;
  /**
   * The per-agent HTTP signing secret (gateway HTTP transport). Returned when
   * the endpoint claim succeeds, so a restarted agent can re-obtain it without
   * manual configuration.
   */
  signingSecret?: string;
}

/**
 * HTTP transport onboarding: claim this agent's endpoint URL using the
 * per-agent connect token the operator issued, and receive the signing secret
 * in return. Registration itself (the DSL) is done out-of-band in the gateway
 * UI — this only tells the gateway where to POST invokes. Non-fatal.
 */
export async function claimHttpEndpoint(options: ClaimOptions = {}): Promise<ClaimResult> {
  const gatewayUrl = options.gatewayUrl || GATEWAY_URL;
  const connectToken = options.connectToken ?? AGENT_CONNECT_TOKEN;
  const attempts = options.attempts ?? 5;
  const url = resolveHttpEndpointUrl();

  if (!url) {
    console.warn('GATEWAY_TRANSPORT=http but no AGENT_PUBLIC_URL / RAILWAY_PUBLIC_DOMAIN is set — cannot claim an endpoint.');
    return { registered: false };
  }
  if (!connectToken) {
    console.warn('GATEWAY_TRANSPORT=http with no AGENT_CONNECT_TOKEN — cannot self-claim the endpoint (set GATEWAY_SIGNING_SECRET instead).');
    return { registered: false };
  }

  const endpointUrl = new URL(`/v1/agents/${encodeURIComponent(AGENT_ID)}/endpoint`, gatewayUrl);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${connectToken}` },
        body: JSON.stringify({ url })
      });
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        console.log(`Claimed HTTP endpoint for ${AGENT_ID} at ${url}`);
        return { registered: true, signingSecret: readSigningSecret(body) };
      }
      console.warn(`Endpoint claim failed (${response.status}): ${await safeErrorDetail(response)}`);
    } catch (err) {
      console.warn(`Endpoint claim error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (attempt < attempts - 1) {
      await sleep(nextClaimDelay(attempt));
    }
  }
  console.error(`Endpoint claim gave up after ${attempts} attempts; the gateway may not be able to invoke ${AGENT_ID}.`);
  return { registered: false };
}

function readSigningSecret(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'signingSecret' in body) {
    const secret = (body as { signingSecret?: unknown }).signingSecret;
    return typeof secret === 'string' && secret.length > 0 ? secret : undefined;
  }
  return undefined;
}

function resolveHttpEndpointUrl(): string | undefined {
  if (!ENABLE_GATEWAY_HTTP || !AGENT_PUBLIC_URL) {
    return undefined;
  }
  return new URL(GATEWAY_INVOKE_PATH, AGENT_PUBLIC_URL).toString();
}

async function safeErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '<no body>';
  }
}

function nextClaimDelay(attempt: number): number {
  return Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
