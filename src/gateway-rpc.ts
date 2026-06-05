import { runAgent } from './agent.js';
import type {
  GatewayInvokeRequestFrame,
  GatewayInvokeResponseFrame
} from './types.js';

/**
 * Transport-agnostic core of an inbound gateway invoke. Both the WebSocket
 * connector (gateway.ts) and the HTTP transport (gateway-http.ts) turn a
 * validated invoke frame into a response frame through here. The gateway has
 * already validated frame.input against the registered schema, so the input
 * (`{ message: "<prompt>" }`) goes straight to the agent.
 */
export async function handleInvokeFrame(frame: GatewayInvokeRequestFrame): Promise<GatewayInvokeResponseFrame> {
  try {
    const output = await runAgent(frame.input);
    return {
      type: 'invoke.response',
      requestId: frame.requestId,
      ok: true,
      result: {
        // Echo the contract id the gateway invoked us with.
        contract: frame.contract,
        output
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
