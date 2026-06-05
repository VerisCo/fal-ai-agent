import WebSocket, { type RawData } from 'ws';
import {
  AGENT_CONNECT_TOKEN,
  AGENT_ID,
  ENABLE_GATEWAY_HTTP,
  GATEWAY_URL
} from './config.js';
import { emitOverHttp } from './gateway-http.js';
import { handleInvokeFrame } from './gateway-rpc.js';
import type {
  AgentEmitFrame,
  EmitResult,
  GatewayInvokeRequestFrame
} from './types.js';

interface GatewayConnectorOptions {
  gatewayUrl?: string;
  agentId?: string;
  token?: string;
  reconnect?: boolean;
}

interface GatewayConnector {
  stop(): void;
}

// The currently-open gateway socket and the emissions awaiting an ack. Kept at
// module scope so emitToGateway() can push frames without a connector handle;
// the connector keeps these in sync as it (re)connects.
let currentSocket: WebSocket | undefined;
const pendingEmits = new Map<string, { resolve: (result: EmitResult) => void; timer: NodeJS.Timeout }>();

/**
 * Push an unsolicited frame to the gateway and await its ack. Returns a result
 * rather than throwing, so callers (e.g. a scheduler poll loop) can retry on a
 * transient failure. Resolves ok:false immediately when no socket is connected.
 */
export function emitToGateway(frame: AgentEmitFrame, timeoutMs = 10_000): Promise<EmitResult> {
  if (!frame.emissionId) {
    return Promise.resolve({ ok: false, error: { code: 'invalid_emission', message: 'emissionId is required' } });
  }
  // Prefer the live WebSocket; otherwise fall back to the HTTP emit callback
  // (the only path in pure http transport, and a graceful fallback in 'both').
  const socket = currentSocket;
  if (socket && socket.readyState === WebSocket.OPEN) {
    return emitOverSocket(socket, frame, timeoutMs);
  }
  if (ENABLE_GATEWAY_HTTP) {
    return emitOverHttp(frame, timeoutMs);
  }
  return Promise.resolve({ ok: false, error: { code: 'not_connected', message: 'No active gateway connection' } });
}

function emitOverSocket(socket: WebSocket, frame: AgentEmitFrame, timeoutMs: number): Promise<EmitResult> {
  return new Promise<EmitResult>((resolve) => {
    const timer = setTimeout(() => {
      pendingEmits.delete(frame.emissionId);
      resolve({ ok: false, error: { code: 'ack_timeout', message: 'Gateway did not acknowledge the emission' } });
    }, timeoutMs);
    pendingEmits.set(frame.emissionId, { resolve, timer });
    send(socket, frame);
  });
}

function failPendingEmits(code: string, message: string): void {
  for (const [id, pending] of pendingEmits) {
    clearTimeout(pending.timer);
    pending.resolve({ ok: false, error: { code, message } });
    pendingEmits.delete(id);
  }
}

export function startGatewayConnector(options: GatewayConnectorOptions = {}): GatewayConnector {
  const gatewayUrl = options.gatewayUrl || GATEWAY_URL;
  const agentId = options.agentId || AGENT_ID;
  const token = options.token ?? AGENT_CONNECT_TOKEN;
  const reconnect = options.reconnect ?? true;
  let stopped = false;
  let reconnectAttempt = 0;
  let socket: WebSocket | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;

  const connect = () => {
    if (stopped) {
      return;
    }

    const wsUrl = buildAgentConnectUrl(gatewayUrl, agentId, token);
    const activeSocket = new WebSocket(wsUrl);
    socket = activeSocket;

    activeSocket.on('open', () => {
      reconnectAttempt = 0;
      currentSocket = activeSocket;
      send(activeSocket, { type: 'agent.hello', agentId });
      console.log(`Connected ${agentId} to marketplace gateway ${gatewayUrl}`);
    });

    activeSocket.on('message', (data) => {
      void handleGatewayMessage(data, activeSocket);
    });

    activeSocket.on('close', () => {
      if (currentSocket === activeSocket) {
        currentSocket = undefined;
        // Fail emissions waiting on this socket so the caller can retry once
        // we reconnect, rather than hanging until the ack timeout.
        failPendingEmits('disconnected', 'Gateway connection closed');
      }
      if (!stopped && reconnect) {
        const delay = nextReconnectDelay(reconnectAttempt);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, delay);
        console.warn(`Gateway connection closed; reconnecting in ${delay}ms`);
      }
    });

    activeSocket.on('error', (err) => {
      console.error(`Gateway connection error: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socket?.close(1000, 'agent shutdown');
    }
  };
}

export function buildAgentConnectUrl(gatewayUrl: string, agentId: string, token?: string): string {
  const url = new URL(`/v1/agents/${encodeURIComponent(agentId)}/connect`, gatewayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (token) {
    url.searchParams.set('token', token);
  }
  return url.toString();
}

async function handleGatewayMessage(data: RawData, socket: WebSocket): Promise<void> {
  const frame = parseFrame(data);
  if (!frame || typeof frame.type !== 'string') {
    send(socket, {
      type: 'error',
      code: 'invalid_frame',
      message: 'Expected JSON gateway frame'
    });
    return;
  }

  if (frame.type === 'gateway.connected' || frame.type === 'agent.hello.ack') {
    return;
  }

  if (frame.type === 'emit.ack') {
    const emissionId = typeof frame.emissionId === 'string' ? frame.emissionId : '';
    const pending = pendingEmits.get(emissionId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingEmits.delete(emissionId);
      pending.resolve({ ok: frame.ok === true, error: frame.error as EmitResult['error'] });
    }
    return;
  }

  if (frame.type !== 'invoke.request') {
    send(socket, {
      type: 'error',
      code: 'unsupported_frame',
      message: `Unsupported gateway frame: ${frame.type}`
    });
    return;
  }

  const request = frame as unknown as GatewayInvokeRequestFrame;
  const response = await handleInvokeFrame(request);
  send(socket, response);
}

function parseFrame(data: RawData): Record<string, unknown> | undefined {
  try {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : Buffer.isBuffer(data)
        ? data.toString('utf8')
        : data.toString();
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function send(socket: WebSocket | undefined, frame: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(frame));
  }
}

function nextReconnectDelay(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
}
