import type { FalImage } from './types.js';

// Synchronous fal.ai inference endpoint. Model ids map directly onto paths,
// e.g. https://fal.run/fal-ai/flux/schnell. Fast models (schnell) complete in
// a couple of seconds, so the blocking endpoint is fine; switch to the queue
// API (queue.fal.run) if you move to a slow model.
const DEFAULT_FAL_RUN_BASE_URL = 'https://fal.run';

const REQUEST_TIMEOUT_MS = 60_000;

export interface FalGenerateResult {
  images: FalImage[];
  seed?: number;
  model: string;
}

export function falModelEndpoint(model: string, baseUrl?: string): string {
  const base = (baseUrl || process.env.FAL_RUN_BASE_URL || DEFAULT_FAL_RUN_BASE_URL).replace(/\/+$/, '');
  return `${base}/${model.replace(/^\/+|\/+$/g, '')}`;
}

export async function generateImage(prompt: string, model: string): Promise<FalGenerateResult> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error('FAL_KEY is not set. Create a key at https://fal.ai/dashboard/keys and set it in the environment.');
  }

  const response = await fetch(falModelEndpoint(model), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`
    },
    body: JSON.stringify({
      prompt,
      image_size: process.env.FAL_IMAGE_SIZE || 'landscape_4_3',
      num_images: 1
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`fal.ai request failed (${response.status}): ${body || response.statusText}`);
  }

  const data = await response.json() as { images?: FalImage[]; seed?: number };
  const images = (data.images || []).filter((image) => typeof image?.url === 'string' && image.url);
  if (!images.length) {
    throw new Error('fal.ai returned no images');
  }

  return { images, seed: data.seed, model };
}
