import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AGENT_CONNECT_TOKEN,
  AGENT_DESCRIPTION,
  AGENT_ID,
  AGENT_NAME,
  AUTO_REGISTER,
  CONNECTION_MODE,
  DEFAULT_MODEL,
  ENABLE_GATEWAY_CONNECTOR,
  ENABLE_GATEWAY_HTTP,
  ENABLE_HTTP_INVOKE,
  ENABLE_WS_CONNECTOR,
  GATEWAY_INVOKE_PATH,
  buildAgentManifest
} from './config.js';
import { verifyJwt } from './auth/verifyToken.js';
import { runAgent } from './agent.js';
import { startGatewayConnector } from './gateway.js';
import { processGatewayHttpInvoke, setSigningSecret } from './gateway-http.js';
import { claimHttpEndpoint, registerWithGateway } from './register.js';
import type { AgentInvokeRequest, AgentInvokeResponse } from './types.js';

dotenv.config();

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const isDevelopment = process.env.NODE_ENV === 'development';
const skipAuth = process.env.SKIP_AUTH === 'true' && isDevelopment;

app.use(helmet());
// Comma-separated allowlist for browser callers; defaults to allowing any
// origin (the API is protected by auth, not CORS).
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins, credentials: true } : {}));
app.use(express.json({
  limit: '10mb',
  // Capture the raw body so the gateway HTTP transport can verify the request
  // signature against the exact bytes received.
  verify: (req, _res, buf) => {
    (req as unknown as { rawBody?: string }).rawBody = buf.toString('utf8');
  }
}));

if (isDevelopment) {
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}

// Simple static API key for the standalone /invoke and /chat endpoints. When
// AGENT_API_KEY is set, callers authenticate with `Authorization: Bearer <key>`
// instead of a Commands.com JWT.
const agentApiKey = process.env.AGENT_API_KEY || '';

function constantTimeEquals(a: string, b: string): boolean {
  // Hash both sides so the comparison is constant-time even when lengths differ.
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest()
  );
}

function verifyApiKey(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token || !constantTimeEquals(token, agentApiKey)) {
    res.status(401).json({
      error: {
        code: 'unauthorized',
        message: 'Authorization header with a valid Bearer API key required'
      }
    });
    return;
  }

  req.user = { sub: 'api-key', scope: 'agent:invoke' };
  next();
}

const authMiddleware = skipAuth
  ? (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      req.user = {
        sub: 'dev-user',
        email: 'dev@example.com',
        scope: 'agent:invoke'
      };
      next();
    }
  : agentApiKey
    ? verifyApiKey
    : verifyJwt;

function errorResponse(requestId: string, code: string, message: string): AgentInvokeResponse {
  return {
    requestId,
    status: 'failed',
    outputs: [],
    error: { code, message }
  };
}

const httpInvokeEnabledMiddleware = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!ENABLE_HTTP_INVOKE) {
    return res.status(404).json(errorResponse(randomUUID(), 'http_invoke_disabled', 'HTTP invoke is disabled for this agent'));
  }
  return next();
};

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    agent: {
      id: AGENT_ID,
      name: AGENT_NAME,
      model: DEFAULT_MODEL
    }
  });
});

app.get('/.well-known/agent.json', (_req, res) => {
  res.json(buildAgentManifest());
});

app.get('/', (_req, res) => {
  res.json({
    id: AGENT_ID,
    name: AGENT_NAME,
    description: AGENT_DESCRIPTION,
    connectionMode: CONNECTION_MODE,
    endpoints: {
      health: '/health',
      discovery: '/.well-known/agent.json',
      invoke: ENABLE_HTTP_INVOKE ? '/invoke' : null,
      chat: ENABLE_HTTP_INVOKE ? '/chat' : null
    }
  });
});

app.post('/invoke', httpInvokeEnabledMiddleware, authMiddleware, async (req, res) => {
  const body = req.body as Partial<AgentInvokeRequest>;
  const requestId = body.requestId || randomUUID();

  if (!body.input || typeof body.input !== 'object') {
    return res.status(400).json(errorResponse(requestId, 'invalid_request', 'input envelope is required'));
  }

  try {
    const result = await runAgent(body as AgentInvokeRequest);
    const response: AgentInvokeResponse = {
      requestId,
      status: 'completed',
      outputs: [result.output],
      usage: result.usage
    };
    return res.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Unsupported input contract') ? 400 : 500;
    return res.status(status).json(errorResponse(requestId, status === 400 ? 'unsupported_contract' : 'agent_error', message));
  }
});

app.post('/chat', httpInvokeEnabledMiddleware, authMiddleware, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message : '';
  if (!message.trim()) {
    return res.status(400).json({ error: { code: 'invalid_request', message: 'message is required' } });
  }

  const request: AgentInvokeRequest = {
    requestId: req.body?.requestId || randomUUID(),
    from: { type: 'human', id: req.user?.sub || 'anonymous' },
    input: {
      contract: 'chat_message.v1',
      data: { message }
    }
  };

  try {
    const result = await runAgent(request);
    return res.json({
      requestId: request.requestId,
      message: (result.output.data as { answer?: string }).answer || '',
      output: result.output,
      usage: result.usage
    });
  } catch (err) {
    return res.status(500).json({
      error: {
        code: 'agent_error',
        message: err instanceof Error ? err.message : String(err)
      }
    });
  }
});

// Gateway HTTP transport: the gateway POSTs signed invokes here. Authenticated
// by the per-agent signature inside processGatewayHttpInvoke (not JWT), so it is
// mounted without the JWT auth middleware.
if (ENABLE_GATEWAY_HTTP) {
  app.post(GATEWAY_INVOKE_PATH, async (req, res) => {
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const result = await processGatewayHttpInvoke(
      rawBody,
      req.headers as Record<string, string | string[] | undefined>
    );
    res.status(result.status).json(result.body);
  });
}

app.use('*', (req, res) => {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: 'Endpoint not found',
      path: req.originalUrl
    }
  });
});

app.listen(PORT, () => {
  console.log(`${AGENT_NAME} running on http://localhost:${PORT}`);
  if (ENABLE_GATEWAY_CONNECTOR) {
    void (async () => {
      let connectToken: string | undefined;
      if (AUTO_REGISTER) {
        const result = await registerWithGateway();
        connectToken = result.connectToken;
        // HTTP transport: adopt the signing secret handed back at registration
        // so we can verify invokes and sign emits without a manual env step.
        if (result.signingSecret) {
          setSigningSecret(result.signingSecret);
        }
      } else if (ENABLE_GATEWAY_HTTP && AGENT_CONNECT_TOKEN) {
        // Third-party HTTP transport (no admin token): self-claim the endpoint
        // URL with the per-agent connect token and adopt the signing secret.
        const result = await claimHttpEndpoint();
        if (result.signingSecret) {
          setSigningSecret(result.signingSecret);
        }
      }
      if (ENABLE_WS_CONNECTOR) {
        // Prefer the per-agent token minted during registration; otherwise fall
        // back to the operator-issued AGENT_CONNECT_TOKEN from the environment.
        startGatewayConnector(connectToken ? { token: connectToken } : {});
      } else if (ENABLE_GATEWAY_HTTP) {
        console.log(`HTTP transport: gateway invokes accepted at POST ${GATEWAY_INVOKE_PATH}`);
      }
    })();
  }
  if (isDevelopment) {
    console.log(`Agent ID: ${AGENT_ID}`);
    console.log(`Model: ${DEFAULT_MODEL}`);
    console.log(`Connection mode: ${CONNECTION_MODE}`);
    console.log(`Authentication: ${skipAuth ? 'DISABLED (dev mode)' : 'ENABLED'}`);
  }
});

export default app;
