import {
  AGENT_ID,
  GATEWAY_EMIT_PATH,
  GATEWAY_SIGNING_SECRET,
  GATEWAY_URL
} from './config.js';
import { buildSignatureHeaders, verifyRequest } from './agent-signing.js';
import { handleInvokeFrame } from './gateway-rpc.js';
import type { AgentEmitFrame, EmitResult, GatewayInvokeRequestFrame } from './types.js';

/**
 * Gateway HTTP transport (the inverse of the WebSocket connector): instead of
 * dialing out and holding a socket, the agent is an addressable service the
 * gateway POSTs invokes to, and it POSTs emissions back. Both directions are
 * authenticated with the per-agent signing secret. This module is framework-
 * agnostic — index.ts adapts processGatewayHttpInvoke() onto an Express route.
 */

// The signing secret can arrive via env or be filled in after self-registration
// (the gateway returns it once), so it lives in mutable module state.
let signingSecret = GATEWAY_SIGNING_SECRET;

export function setSigningSecret(secret: string): void {
  if (secret) {
    signingSecret = secret;
  }
}

export function getSigningSecret(): string {
  return signingSecret;
}

type HeaderBag = Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export interface GatewayHttpResult {
  status: number;
  body: unknown;
}

/**
 * Verify and execute an invoke the gateway POSTed. `rawBody` MUST be the exact
 * bytes received (the signature covers them), not a re-serialized object.
 */
export async function processGatewayHttpInvoke(rawBody: string, headers: HeaderBag): Promise<GatewayHttpResult> {
  if (!signingSecret) {
    // Misconfiguration: without the secret we can't authenticate the gateway.
    console.error('[gateway-http] no signing secret configured; rejecting invoke');
    return { status: 401, body: { ok: false, error: { code: 'no_signing_secret', message: 'Agent has no gateway signing secret configured' } } };
  }
  const verified = verifyRequest(
    signingSecret,
    header(headers, 'x-veris-timestamp'),
    rawBody,
    header(headers, 'x-veris-signature')
  );
  if (!verified) {
    return { status: 401, body: { ok: false, error: { code: 'invalid_signature', message: 'Invalid or missing gateway signature' } } };
  }

  let frame: GatewayInvokeRequestFrame;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.contract !== 'string') {
      throw new Error('not an invoke frame');
    }
    frame = parsed as GatewayInvokeRequestFrame;
  } catch {
    return { status: 400, body: { ok: false, error: { code: 'invalid_frame', message: 'Expected a JSON invoke frame' } } };
  }

  const response = await handleInvokeFrame(frame);
  if (response.ok) {
    return { status: 200, body: { result: response.result } };
  }
  // 200 with an ok:false envelope — the gateway maps this to an agent error.
  return { status: 200, body: { ok: false, error: response.error } };
}

/**
 * Push an emission to the gateway over HTTP (the transport-http counterpart of
 * the WebSocket emit). Signs the body with the per-agent secret; returns a
 * result rather than throwing so a scheduler poll loop can retry.
 */
export async function emitOverHttp(frame: AgentEmitFrame, timeoutMs = 10_000): Promise<EmitResult> {
  if (!frame.emissionId) {
    return { ok: false, error: { code: 'invalid_emission', message: 'emissionId is required' } };
  }
  if (!signingSecret) {
    return { ok: false, error: { code: 'no_signing_secret', message: 'GATEWAY_SIGNING_SECRET is not set' } };
  }

  const rawBody = JSON.stringify(frame);
  const headers = buildSignatureHeaders(signingSecret, AGENT_ID, frame.emissionId, rawBody);
  const url = new URL(GATEWAY_EMIT_PATH(AGENT_ID), GATEWAY_URL).toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'POST', headers, body: rawBody, signal: controller.signal });
    if (response.ok) {
      return { ok: true };
    }
    const detail = (await response.json().catch(() => ({}))) as { error?: EmitResult['error'] };
    return {
      ok: false,
      error: detail.error ?? { code: 'emit_failed', message: `Gateway returned ${response.status}` }
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: controller.signal.aborted ? 'ack_timeout' : 'emit_unreachable',
        message: err instanceof Error ? err.message : String(err)
      }
    };
  } finally {
    clearTimeout(timer);
  }
}
