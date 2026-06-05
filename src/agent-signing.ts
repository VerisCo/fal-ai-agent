import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC request signing for the gateway HTTP transport.
 *
 * The agent holds a per-agent shared secret (handed back by the gateway at
 * registration). It uses that secret both to verify inbound invokes the gateway
 * signs, and to sign outbound emit callbacks the gateway verifies. The agent
 * never derives the secret — only the gateway does — so there is no master key
 * here.
 */

const SIGNATURE_VERSION = 'vs1';
const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;

/** Sign `${timestamp}.${rawBody}`; returns the X-Veris-Signature value. */
export function signRequest(secret: string, timestamp: string, rawBody: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('base64url');
  return `${SIGNATURE_VERSION}=${mac}`;
}

export interface VerifyOptions {
  maxSkewMs?: number;
  now?: number;
}

export function verifyRequest(
  secret: string,
  timestamp: string | undefined,
  rawBody: string,
  signature: string | undefined,
  options: VerifyOptions = {}
): boolean {
  if (!secret || !timestamp || !signature) {
    return false;
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }
  const now = options.now ?? Date.now();
  const skew = options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  if (Math.abs(now - ts) > skew) {
    return false; // stale or future-dated → replay defense
  }
  return safeEqual(signature, signRequest(secret, timestamp, rawBody));
}

export interface SignatureHeaders {
  [key: string]: string;
  'content-type': string;
  'x-veris-timestamp': string;
  'x-veris-agent-id': string;
  'x-veris-request-id': string;
  'x-veris-signature': string;
}

export function buildSignatureHeaders(
  secret: string,
  agentId: string,
  requestId: string,
  rawBody: string,
  now: number = Date.now()
): SignatureHeaders {
  const timestamp = String(now);
  return {
    'content-type': 'application/json',
    'x-veris-timestamp': timestamp,
    'x-veris-agent-id': agentId,
    'x-veris-request-id': requestId,
    'x-veris-signature': signRequest(secret, timestamp, rawBody)
  };
}

function safeEqual(a: string, b: string): boolean {
  const actual = Buffer.from(a);
  const expected = Buffer.from(b);
  if (actual.length !== expected.length || actual.length === 0) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
