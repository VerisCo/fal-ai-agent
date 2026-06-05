import { DEFAULT_MODEL } from './config.js';
import { generateImage } from './fal.js';
import type { AgentAnswer, AgentInvokeRequest } from './types.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function extractPrompt(request: AgentInvokeRequest): string {
  const { contract, data } = request.input;
  const body = asRecord(data);

  if (contract === 'question.v1') {
    const question = body.question;
    const context = body.context;
    if (typeof question !== 'string' || !question.trim()) {
      throw new Error('question.v1 requires data.question');
    }
    // Treat optional context as extra style/composition guidance for the image.
    return [question.trim(), typeof context === 'string' && context.trim() ? context.trim() : '']
      .filter(Boolean)
      .join(', ');
  }

  if (contract === 'chat_message.v1') {
    const message = body.message;
    if (typeof message !== 'string' || !message.trim()) {
      throw new Error('chat_message.v1 requires data.message');
    }
    return message;
  }

  throw new Error(`Unsupported input contract: ${contract}`);
}

export async function runAgent(request: AgentInvokeRequest) {
  const prompt = extractPrompt(request);
  const result = await generateImage(prompt, DEFAULT_MODEL);

  const answer: AgentAnswer = {
    // The primary payload is the hosted image URL, so /chat callers get a
    // directly usable link back as the message.
    answer: result.images[0].url,
    citations: result.images.map((image, index) => ({
      source: image.url,
      label: `Generated image ${index + 1} (${result.model})`
    })),
    confidence: 'high',
    limitations: ['Image URLs are hosted by fal.ai and may expire — download the file to persist it.']
  };

  return {
    output: {
      contract: 'answer.v1',
      data: answer
    },
    usage: undefined
  };
}
