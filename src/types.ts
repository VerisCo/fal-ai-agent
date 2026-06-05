export interface AgentInputEnvelope {
  contract: string;
  data: unknown;
}

export interface AgentInvokeRequest {
  requestId?: string;
  from?: {
    type?: 'human' | 'agent' | 'gateway' | string;
    id?: string;
  };
  input: AgentInputEnvelope;
  metadata?: Record<string, unknown>;
}

export interface AgentOutputEnvelope {
  contract: string;
  data: unknown;
}

export interface AgentInvokeResponse {
  requestId: string;
  status: 'completed' | 'failed';
  outputs: AgentOutputEnvelope[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface FalImage {
  url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

export interface AgentAnswer {
  answer: string;
  citations: Array<{
    source: string;
    label: string;
  }>;
  confidence: 'low' | 'medium' | 'high';
  limitations: string[];
}

export interface GatewayInvokeRequestFrame {
  type: 'invoke.request';
  requestId: string;
  agentId: string;
  contract: string;
  input: unknown;
  context?: Record<string, unknown>;
  deadlineMs?: number;
}

export interface GatewayInvokeResponseFrame {
  type: 'invoke.response';
  requestId: string;
  ok: boolean;
  result?: {
    contract: string;
    output: unknown;
    usage?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * An unsolicited frame the agent pushes to the gateway (the reverse of an
 * invoke). Used when something the agent scheduled fires. `delivery` is the
 * opaque token the gateway handed the agent in an earlier invoke's context.
 */
export interface AgentEmitFrame {
  type: 'agent.emit';
  emissionId: string;
  delivery: string;
  /** Emission contract id, declared in this agent's manifest `emissions`. */
  contract: string;
  payload: { text?: string } & Record<string, unknown>;
  reminderId?: string;
}

export interface EmitAckFrame {
  type: 'emit.ack';
  emissionId: string;
  ok: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface EmitResult {
  ok: boolean;
  error?: {
    code: string;
    message: string;
  };
}
