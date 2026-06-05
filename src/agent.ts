import { DEFAULT_MODEL } from './config.js';
import { generateImage } from './fal.js';
import type { ImageGenerationOutput } from './types.js';

/** The gateway sends `{ message: "<prompt>" }` — that's the whole input. */
export function extractPrompt(input: unknown): string {
  const body = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const message = body.message;
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error('input.message is required');
  }
  return message.trim();
}

export async function runAgent(input: unknown): Promise<ImageGenerationOutput> {
  const prompt = extractPrompt(input);
  const result = await generateImage(prompt, DEFAULT_MODEL);
  return { image_url: result.images[0].url };
}
