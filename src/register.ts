import {
  AGENT_CONNECT_TOKEN,
  AGENT_ID,
  AGENT_PUBLIC_URL,
  ENABLE_GATEWAY_HTTP,
  GATEWAY_ADMIN_TOKEN,
  GATEWAY_INVOKE_PATH,
  GATEWAY_URL,
  REGISTER_STATUS,
  buildAgentManifest
} from './config.js';

interface RegisterOptions {
  gatewayUrl?: string;
  adminToken?: string;
  status?: string;
  attempts?: number;
}

export interface RegisterResult {
  registered: boolean;
  /**
   * The per-agent connect token to use for the WebSocket connection. Minted by
   * the gateway on create and on rotation, and only ever returned once per
   * mint — so the agent rotates on restart to obtain a fresh, usable token.
   */
  connectToken?: string;
  /**
   * The per-agent HTTP signing secret (gateway HTTP transport). Returned on
   * create and re-fetchable from the signing-secret endpoint, so a restarted
   * agent can re-obtain it without manual configuration.
   */
  signingSecret?: string;
}

/**
 * First-party convenience: publish this agent's manifest to the gateway on
 * startup and obtain a per-agent connect token. Requires the admin token, so
 * it's only used by agents the operator runs themselves. Third-party agents are
 * registered by the operator out-of-band and receive their connect token to set
 * as AGENT_CONNECT_TOKEN. Non-fatal — failures are logged, not thrown.
 */
export async function registerWithGateway(options: RegisterOptions = {}): Promise<RegisterResult> {
  const gatewayUrl = options.gatewayUrl || GATEWAY_URL;
  const adminToken = options.adminToken ?? GATEWAY_ADMIN_TOKEN;
  const status = options.status || REGISTER_STATUS;
  const attempts = options.attempts ?? 5;
  const manifest = buildAgentManifest();

  // HTTP transport: register the public URL the gateway will POST to.
  const httpUrl = resolveHttpEndpointUrl();
  const endpointFields = httpUrl ? { url: httpUrl } : {};
  if (ENABLE_GATEWAY_HTTP && !httpUrl) {
    console.warn(
      'GATEWAY_TRANSPORT=http but no AGENT_PUBLIC_URL / RAILWAY_PUBLIC_DOMAIN is set — the gateway will have no URL to call.'
    );
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const exists = await listingExists(gatewayUrl, AGENT_ID, adminToken);

      if (!exists) {
        const created = await postJson(new URL('/v1/agents', gatewayUrl), adminToken, {
          status,
          manifest,
          ...endpointFields
        });
        console.log(`Registered ${AGENT_ID} with gateway ${gatewayUrl} (status=${status})`);
        return { registered: true, connectToken: readConnectToken(created), signingSecret: readSigningSecret(created) };
      }

      // Listing already exists: refresh the manifest (and endpoint URL).
      await putJson(new URL(`/v1/agents/${encodeURIComponent(AGENT_ID)}`, gatewayUrl), adminToken, {
        status,
        manifest,
        ...endpointFields
      });

      if (ENABLE_GATEWAY_HTTP) {
        // HTTP transport re-fetches its (deterministic) signing secret rather
        // than rotating a WebSocket connect token.
        const secret = await postJson(
          new URL(`/v1/agents/${encodeURIComponent(AGENT_ID)}/signing-secret`, gatewayUrl),
          adminToken,
          {}
        );
        console.log(`Refreshed ${AGENT_ID} registration and fetched signing secret`);
        return { registered: true, signingSecret: readSigningSecret(secret) };
      }

      // WebSocket transport: rotate to obtain a usable connect token (the
      // original was only shown once at creation).
      const rotated = await postJson(
        new URL(`/v1/agents/${encodeURIComponent(AGENT_ID)}/connect-token`, gatewayUrl),
        adminToken,
        {}
      );
      console.log(`Refreshed ${AGENT_ID} registration and rotated connect token`);
      return { registered: true, connectToken: readConnectToken(rotated) };
    } catch (err) {
      console.warn(
        `Gateway registration error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (attempt < attempts - 1) {
      await sleep(nextRegisterDelay(attempt));
    }
  }

  console.error(
    `Gateway registration gave up after ${attempts} attempts; the agent may not be discoverable.`
  );
  return { registered: false };
}

interface ClaimOptions {
  gatewayUrl?: string;
  connectToken?: string;
  attempts?: number;
}

/**
 * Third-party HTTP transport onboarding (no admin token): claim this agent's
 * endpoint URL using the per-agent connect token the operator issued, and
 * receive the signing secret in return. Self-service equivalent of the admin
 * registration flow — set GATEWAY_TRANSPORT=http + AGENT_CONNECT_TOKEN +
 * AGENT_PUBLIC_URL and the agent onboards itself on boot. Non-fatal.
 */
export async function claimHttpEndpoint(options: ClaimOptions = {}): Promise<RegisterResult> {
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
      await sleep(nextRegisterDelay(attempt));
    }
  }
  console.error(`Endpoint claim gave up after ${attempts} attempts; the gateway may not be able to invoke ${AGENT_ID}.`);
  return { registered: false };
}

async function listingExists(gatewayUrl: string, agentId: string, adminToken: string): Promise<boolean> {
  const url = new URL(`/v1/agents/${encodeURIComponent(agentId)}`, gatewayUrl);
  const response = await fetch(url, { headers: buildHeaders(adminToken) });
  if (response.status === 404) {
    return false;
  }
  if (response.ok) {
    return true;
  }
  throw new Error(`Unexpected status checking listing: ${response.status}`);
}

async function postJson(url: URL, adminToken: string, body: unknown): Promise<unknown> {
  return sendJson('POST', url, adminToken, body);
}

async function putJson(url: URL, adminToken: string, body: unknown): Promise<unknown> {
  return sendJson('PUT', url, adminToken, body);
}

async function sendJson(method: string, url: URL, adminToken: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: buildHeaders(adminToken),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await safeErrorDetail(response);
    throw new Error(`${method} ${url.pathname} failed (${response.status}): ${detail}`);
  }
  return response.json().catch(() => ({}));
}

function readConnectToken(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'connectToken' in body) {
    const token = (body as { connectToken?: unknown }).connectToken;
    return typeof token === 'string' && token.length > 0 ? token : undefined;
  }
  return undefined;
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

function buildHeaders(adminToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (adminToken) {
    headers.authorization = `Bearer ${adminToken}`;
  }
  return headers;
}

async function safeErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '<no body>';
  }
}

function nextRegisterDelay(attempt: number): number {
  return Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
