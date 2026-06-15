# Deploying the AFM Ballerina runtime on WSO2 Devant

This guide walks through deploying the Ballerina AFM interpreter (with a sample agent) as a
hosted HTTP service on **WSO2 Devant**.

## What this branch adds

- `resources/agent.afm.md` — a simple `webchat` agent (OpenAI `gpt-4o`, API key read from the
  `OPENAI_API_KEY` environment variable).
- `Dockerfile` — a `CMD` so the container loads `resources/agent.afm.md` on startup.
- `.choreo/component.yaml` — declares the HTTP endpoint (port `8085`) for Devant/Choreo.

The runtime serves:
- `POST /chat` — send a plain-text message, get a plain-text reply. Requires an
  `X-Session-Id` header (used to keep separate conversation histories).
- `GET  /chat/ui` — a simple browser chat UI.

## Prerequisites

- A **WSO2 Devant** account (free tier).
- This repo on **GitHub** (your fork).
- An **OpenAI API key** with some credit.
- (Optional, for local testing) **Docker Desktop** running.

## 1. Test locally first (recommended)

The image builds with the pinned Ballerina version inside Docker, so you don't need a matching
local Ballerina install.

```bash
cd ballerina-interpreter

# Build the image
docker build -t afm-devant-demo .

# Run it (replace with your real key)
docker run --rm -p 8085:8085 -e OPENAI_API_KEY="sk-..." afm-devant-demo
```

In another terminal:

```bash
# Plain-text body, plain-text reply (X-Session-Id is required)
curl -X POST http://localhost:8085/chat \
  -H "Content-Type: text/plain" \
  -H "X-Session-Id: demo-1" \
  --data "What is 2 + 2?"
```

Or open the UI in a browser: <http://localhost:8085/chat/ui>

If that works locally, Devant will work too.

## 2. Deploy on Devant

> Exact wording in the console may differ — follow the wizard. These are the general steps.

1. **Sign in** to Devant → create/select an **Organization** and **Project**.
2. **Create Component → Service → Connect a Git repository.**
3. **Authorize GitHub**, pick this repo and the `deploy/devant-ballerina` branch.
4. **Build configuration:**
   - Build type: **Dockerfile**
   - Build context / component path: `ballerina-interpreter`
   - Dockerfile path: `ballerina-interpreter/Dockerfile`
5. **Endpoint:** port **8085**, type **REST/HTTP**, visibility **Public**
   (this matches `.choreo/component.yaml`).
6. **Configs & Secrets** (component settings):
   - Add **Secret** `OPENAI_API_KEY` = your OpenAI key.
7. **Build → Deploy** and wait until it's healthy.
8. Copy the **public URL** Devant assigns.

## 3. Test the deployed agent

```bash
curl -X POST https://<your-devant-url>/chat \
  -H "Content-Type: text/plain" \
  -H "X-Session-Id: demo-1" \
  --data "Hello from Devant!"
```

Or open `https://<your-devant-url>/chat/ui`.

## Configuration reference

| What | How | Value |
|---|---|---|
| Which agent file loads | Dockerfile `CMD` (or `afmFilePath` configurable) | `resources/agent.afm.md` |
| Listen port | `port` configurable | `8085` (default) |
| OpenAI key | env var / Devant secret | `OPENAI_API_KEY` |

To deploy a **different agent**, replace `resources/agent.afm.md` (or point `afmFilePath` /
the `CMD` at another file baked into the image).

## Troubleshooting & notes

- **Build fails on `.choreo/component.yaml` schema** — delete the file and let the Devant
  wizard configure the endpoint, then confirm the current schema in Devant's docs.
- **400 `no header value found for 'X-Session-Id'`** — add an `X-Session-Id` header to your
  `POST /chat` request (any value, e.g. `demo-1`). The `/chat/ui` page sends it automatically.
- **401 / no response** — check the `OPENAI_API_KEY` secret is set and has credit.
- **`AFM file path must be provided`** — the `CMD`/`afmFilePath` isn't reaching the runtime;
  verify the file is at `resources/agent.afm.md` in the image.
- **Cost** — every `/chat` call spends OpenAI tokens; keep testing light.
- **Free-tier limits** — confirm Devant free-tier build/runtime/endpoint limits are sufficient.
- **Secret characters** — keep the API key value simple. AFM currently substitutes `${env:...}`
  as text before parsing the YAML, so a secret with special characters (`:`, newlines) can break
  loading (tracked separately).
