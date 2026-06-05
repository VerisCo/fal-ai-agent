# fal-image-agent

Takes a text prompt, generates an image with [fal.ai](https://fal.ai) (FLUX.1 schnell by default), and returns the hosted image URL.

Created with `create-veris-agent`; deployed as a standalone HTTP service on Render.

## Quick start (local)

```bash
npm install
cp .env.example .env
# in .env: set FAL_KEY, uncomment NODE_ENV=development and SKIP_AUTH=true
npm run dev

curl http://localhost:3000/health
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "A watercolor fox in a snowy forest"}'
```

The response's `message` field is the generated image URL:

```json
{
  "requestId": "…",
  "message": "https://fal.media/files/…/output.png",
  "output": {
    "contract": "answer.v1",
    "data": {
      "answer": "https://fal.media/files/…/output.png",
      "citations": [{ "source": "https://fal.media/files/…/output.png", "label": "Generated image 1 (fal-ai/flux/schnell)" }],
      "confidence": "high",
      "limitations": ["Image URLs are hosted by fal.ai and may expire — download the file to persist it."]
    }
  }
}
```

## Deploy to Render

This repo ships a [`render.yaml` blueprint](render.yaml):

1. Push this repo to GitHub.
2. In the Render dashboard: **New → Blueprint**, select the repo.
3. When prompted, set `FAL_KEY` (from [fal.ai dashboard → Keys](https://fal.ai/dashboard/keys)).
4. Render generates a random `AGENT_API_KEY` — copy it from the service's **Environment** tab; callers must send it as a Bearer token.

Then call it:

```bash
curl -X POST https://<your-service>.onrender.com/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -d '{"message": "A retro synthwave city skyline at dusk"}'
```

Alternatively, Render can build the included [`Dockerfile`](Dockerfile) (**New → Web Service → Docker**) — set the same env vars by hand.

## API

| Endpoint | Auth | Description |
| --- | --- | --- |
| `GET /health` | none | Health check (used by Render). |
| `GET /.well-known/agent.json` | none | Veris marketplace manifest. |
| `POST /chat` | Bearer `AGENT_API_KEY` | `{ "message": "<prompt>" }` → image URL in `message`. |
| `POST /invoke` | Bearer `AGENT_API_KEY` | Full contract envelope (see below). |

`POST /invoke` accepts `question.v1` (optional `context` is appended as style guidance) or `chat_message.v1`:

```json
{
  "input": {
    "contract": "question.v1",
    "data": { "question": "A watercolor fox", "context": "soft light, muted palette" }
  }
}
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `FAL_KEY` | — (required) | fal.ai API key. |
| `FAL_MODEL` | `fal-ai/flux/schnell` | Any text-to-image model id on `fal.run` (e.g. `fal-ai/flux/dev`). |
| `FAL_IMAGE_SIZE` | `landscape_4_3` | `square_hd`, `square`, `portrait_4_3`, `portrait_16_9`, `landscape_4_3`, `landscape_16_9`. |
| `AGENT_API_KEY` | — | Static Bearer key for `/invoke` and `/chat`. If unset, falls back to Commands.com JWT verification. |
| `CORS_ORIGINS` | allow all | Comma-separated browser-origin allowlist. |
| `CONNECTION_MODE` | `http` | `http` (standalone), `gateway`, or `both`. |

The default model (`fal-ai/flux/schnell`) is fast enough for the synchronous `fal.run` endpoint. If you switch to a slow model, move `src/fal.ts` to fal's queue API (`queue.fal.run`).

## Veris marketplace (optional)

The scaffolded gateway integration is intact: set `CONNECTION_MODE=gateway` (or `both`), `GATEWAY_URL`, and either `AGENT_CONNECT_TOKEN` (third-party) or `GATEWAY_ADMIN_TOKEN` (first-party). For the HTTP transport on Render also set `GATEWAY_TRANSPORT=http` and `AGENT_PUBLIC_URL=https://<your-service>.onrender.com`. See `.env.example`.

## Development

```bash
npm run dev     # tsx watch mode
npm test        # vitest
npm run build   # tsc → dist/
npm start       # node dist/index.js
```
