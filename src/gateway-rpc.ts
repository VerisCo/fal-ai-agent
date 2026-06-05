import { runAgent } from './agent.js';
import type {
  AgentInvokeRequest,
  GatewayInvokeRequestFrame,
  GatewayInvokeResponseFrame
} from './types.js';

/**
 * Transport-agnostic core of an inbound gateway invoke. Both the WebSocket
 * connector (gateway.ts) and the HTTP transport (gateway-http.ts) turn a
 * validated invoke frame into a response frame through here, so contract
 * dispatch and error mapping are identical regardless of how the frame arrived.
 */
export async function handleInvokeFrame(frame: GatewayInvokeRequestFrame): Promise<GatewayInvokeResponseFrame> {
  try {
    const request = toAgentInvokeRequest(frame);
    const result = await runAgent(request);
    return {
      type: 'invoke.response',
      requestId: frame.requestId,
      ok: true,
      result: {
        contract: result.output.contract,
        output: result.output.data,
        usage: result.usage
      }
    };
  } catch (err) {
    return {
      type: 'invoke.response',
      requestId: frame.requestId,
      ok: false,
      error: {
        code: 'agent_error',
        message: err instanceof Error ? err.message : String(err)
      }
    };
  }
}

export function toAgentInvokeRequest(frame: GatewayInvokeRequestFrame): AgentInvokeRequest {
  if (frame.contract === 'question_answer.v1') {
    return {
      requestId: frame.requestId,
      from: { type: 'gateway', id: 'veris-gateway' },
      input: {
        contract: 'question.v1',
        data: frame.input
      },
      metadata: frame.context
    };
  }

  if (frame.contract === 'chat_answer.v1') {
    return {
      requestId: frame.requestId,
      from: { type: 'gateway', id: 'veris-gateway' },
      input: {
        contract: 'chat_message.v1',
        data: frame.input
      },
      metadata: frame.context
    };
  }

  // Generic passthrough: any other contract id arrives at runAgent with the
  // gateway contract id as the input contract, so custom agents can dispatch on
  // it directly. The gateway has already validated the input against the
  // manifest schema before sending the frame.
  return {
    requestId: frame.requestId,
    from: { type: 'gateway', id: 'veris-gateway' },
    input: {
      contract: frame.contract,
      data: frame.input
    },
    metadata: frame.context
  };
}
