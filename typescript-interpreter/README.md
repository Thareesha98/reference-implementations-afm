# AFM TypeScript Interpreter

A TypeScript-based interpreter for [Agent-Flavored Markdown (AFM)](https://github.com/wso2/agent-flavored-markdown) files that runs entirely in the browser. A `.afm.md` file is loaded into a page, parsed and run inside a Web Worker, and talks directly to the model provider and to the MCP servers the file names. No server executes the agent.

## Features

- **Runs client-side** - the agent loop, tool calls and secret handling all happen in a Web Worker; nothing about the run is sent to WSO2 or to any server other than the model provider, the MCP servers the file declares, and the MCP proxy their traffic is relayed through
- **Model providers** - OpenAI and Anthropic, with your own API key
- **MCP support** for tools (streamable HTTP), relayed through the MCP proxy, with a built-in directory of well-known servers
- **OAuth 2.1 (PKCE) sign-in** for MCP servers that require it, with tokens kept in the worker
- **Tool approval** - tools the agent file lists run without asking; any other tool call shows its server and arguments and waits for you
- **Keys stay in the tab** - a typed secret is held only in the worker's memory and is gone when the tab is closed or refreshed; nothing secret is written to browser storage
- **File attachments** - Markdown, plain text, PDF and images, read in the browser
- **Build, run and share in one place** - start from a blank agent, a template, an AI-written draft or an imported file; edit the role, instructions and tools; share the agent as a link or a `.afm.md` file
- **Single chat interface** - `interfaces` and `skills` are accepted for compatibility with the other AFM interpreters, but there is no console or webhook interface and skills are not loaded; stdio MCP servers cannot run in a browser and are skipped with a warning

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later.
- [pnpm](https://pnpm.io/) 11 or later (`corepack enable` picks up the version pinned in `package.json`).
- An MCP proxy, required for any agent that uses an MCP server. It is a separate Ballerina service that is not part of this repository: a small CORS relay that lets the page reach MCP servers that send no CORS headers.
- An API key for OpenAI or Anthropic, entered in the app when you run an agent.
- A desktop browser. Sign-in opens a pop-up, so allow pop-ups for the app's address. Voice input is offered only where the browser provides speech recognition.

## Quick Start

Start the MCP proxy so that it listens on `http://localhost:8787/` and allows the origin `http://localhost:5173`, then:

```bash
cd typescript-interpreter
pnpm install

# Point the app at the proxy
echo 'VITE_MCP_PROXY_URL=http://localhost:8787/' > packages/web/.env.local

# Start the app
pnpm --filter @afm/web dev
```

Open `http://localhost:5173/`. The first run asks for a model API key and, for any MCP server that needs one, a sign-in or a token. Both stay in the browser tab.

## Usage

1. **Start an agent.** Choose Blank, Generate with AI (describe what you want and get a first version, written with your own key), From a template (four built-in agents), or Import a file (drop an `.afm.md`, or paste a link to one). A share link or `?file=<url>` opens an agent directly (an https address, fetched through the proxy, up to 1 MB), and shows a trust screen first.
2. **Edit it.** Write the role and instructions, pick the model, and connect tools from the directory or by address. The raw `.afm.md` file is editable too.
3. **Run it.** Run opens Setup, which checks the model key and every tool server and asks for what is missing: a key, a token or a sign-in. When everything is ready the chat opens.
4. **Chat.** Attach files and images, stop a reply, regenerate it or edit an earlier message. Tool calls the file does not list ask for approval.
5. **Share it.** Copy a link that carries the whole agent in the URL fragment, or a link to a hosted file, or download the `.afm.md`.

A minimal agent file:

```markdown
---
name: Docs Helper
description: Answers questions about a project's documentation.
model:
  provider: openai
  name: gpt-4o
  authentication:
    type: api-key
    api_key: ${env:OPENAI_API_KEY}
tools:
  mcp:
    - name: docs
      transport:
        type: http
        url: https://mcp.example.com/mcp
        authentication:
          type: bearer
          token: ${env:DOCS_TOKEN}
      tool_filter:
        allow:
          - search_docs
interfaces:
  - type: webchat
---

# Role
You are a helpful documentation assistant.

# Instructions
Answer from the documentation, and say so when you cannot find the answer.
```

`${env:NAME}` stands for a key you enter in the app. It is never read from the environment of the machine.

## Supported AFM Features

| AFM feature | In the browser |
|---|---|
| `model.provider` | `openai` and `anthropic`; any other provider is refused |
| `model.authentication` | `api-key` or `bearer`; `jwt` and `oauth2` are refused (give the model an API key) |
| `tools.mcp[].transport` | `http` (streamable HTTP, through the proxy); `stdio` is skipped with a warning |
| MCP `authentication` | `bearer`, `basic`, `api-key` and `oauth2` sign-in (authorization code with PKCE); the machine grants (`client_credentials`, `password`, `refresh_token`, `jwt_bearer`) are accepted only with their values written in the file; `jwt` is refused |
| `tool_filter` | `allow` and `deny`, applied to each server's own tool names |
| `interfaces` | `webchat`; `consolechat` and `webhook` are warned about and not run |
| `skills` | accepted by the schema, not loaded |
| `max_iterations` | supported (default 10) |
| `${env:NAME}` | resolved from the keys entered in the app |

## Limits

- **A turn** stops starting new steps after 10 steps (or the file's `max_iterations`), 250,000 tokens or 180 seconds. Each tool result is cut to 100,000 characters.
- **Responses** from the proxy are read up to 10 MB; an event stream from a tool server is limited per message.
- **Attachments**: files up to 15 MB each, 100 at a time and 100 MB in total per conversation; images (PNG, JPEG, WebP, GIF) up to 8 MB each and 4 per message; PDFs are read one at a time and stop after 500 pages or 30 seconds.

## Configuration

Configuration via environment variables in `packages/web/.env.local` (see `packages/web/.env.example`). Vite reads them when it starts, so restart the dev server after changing them.

- `VITE_MCP_PROXY_URL` - the proxy's URL, e.g. `http://localhost:8787/` (required if any agent uses an MCP server)
- `VITE_OAUTH_CLIENT_ID_URL` - the public URL of AFM's own OAuth Client ID Metadata Document, if the site hosts one (optional). Production builds also write this document to `oauth/client-metadata.json`. Without it, the app registers itself with each MCP server that supports Dynamic Client Registration

Model API keys and MCP credentials are never set via environment variables - they are entered in the app.

## Building for Production

```bash
pnpm --filter @afm/web build   # packages/web/dist - static files for any host
```

The build is a static site that works on any static host, served from the root of its own address. Sign-in returns to the site's address followed by `/`, so a site served from a sub-path cannot receive the result. The site needs an MCP proxy reachable at `VITE_MCP_PROXY_URL` that allows the site's origin and the `X-Choreo-Correlation-Id` request header, which the app sends so the proxy can keep a separate rate limit per browser tab.

## Troubleshooting

- **"No MCP proxy is configured"** - `VITE_MCP_PROXY_URL` is not set, or the dev server was not restarted after setting it.
- **A tool server "can't be reached from this browser"** - check the server's address, that the proxy is running, and that it allows the page's origin (by default only `http://localhost:5173`).
- **Sign-in does not open** - allow pop-ups for the app's address.

## Testing

```bash
pnpm run typecheck   # every package
pnpm test            # vitest, every package
pnpm audit           # dependency vulnerabilities
```

`pnpm run check` runs typecheck and tests together. CI (`.github/workflows/typescript-interpreter.yml`) runs all three, plus a production build, on every push and pull request that touches this directory.

## Project Structure

This is a pnpm workspace of six packages:

```text
typescript-interpreter/
├── packages/
│   ├── engine/              # @afm/engine - parsing, schema validation, planning, the agent loop
│   ├── adapters/
│   │   ├── auth/            # @afm/adapter-auth  - OAuth 2.1 (PKCE) and OAuth2 client-credentials
│   │   ├── model/           # @afm/adapter-model  - OpenAI and Anthropic model ports
│   │   ├── secret/          # @afm/adapter-secret - secret resolution port
│   │   └── tool/            # @afm/adapter-tool   - MCP client, file tools
│   └── web/                 # @afm/web - the browser app (Vite + React), main thread and worker
├── scripts/typecheck.mjs    # typechecks every package
└── pnpm-workspace.yaml
```

## Adding a Server to the Directory

Connect tools lists the servers written down in `packages/web/src/mcp-directory.ts`; nothing is fetched from a registry. To add one, append an object to `DIRECTORY_ENTRIES` (order does not matter, the list is sorted when shown):

- `url` is the address the publisher's own documentation gives, and `docsUrl` is the page that prints it.
- `auth` is `{ type: "none" }`, `{ type: "bearer", description }` for a key the person pastes, or `{ type: "oauth2", ... }` for sign-in. Copy `authorizeUrl` and `tokenUrl` from the server's `/.well-known/oauth-authorization-server` document; add `registrationUrl` when it has a `registration_endpoint`, `clientIdMetadata: true` when it sets `client_id_metadata_document_supported`, and `scopes` from its 401 challenge or protected-resource metadata. The endpoints must match that document exactly, because sign-in checks them against it.

`pnpm test` rejects an entry with a duplicate id or address, a non-https URL, or an incomplete sign-in.

## Security

The agent's plaintext credentials stay in the Web Worker: the main thread never holds one in the clear. Typed secrets and conversations live in memory for the tab only. The agent library is stored in the browser (localStorage) unencrypted.

The page's Content-Security-Policy has no `unsafe-eval` and a `connect-src` allowlist of exactly `'self'`, `api.openai.com`, `api.anthropic.com`, `raw.githubusercontent.com`, `gist.githubusercontent.com`, and the configured MCP proxy origin. The production build writes this policy into `index.html` as a `<meta>` tag, because static hosts such as GitHub Pages cannot send headers (`public/staticwebapp.config.json` holds the same policy for hosts that can). The agent worker and the pdf.js worker are started from `blob:` URLs so they run under that policy (`worker-src blob:`).

The MCP proxy stores nothing and logs no requests, but it carries MCP and OAuth traffic in transit, including those servers' credentials, tool arguments and results, and sign-in codes and tokens. It blocks requests to private, loopback and link-local addresses and plain `http://` targets (SSRF protection, with an opt-out for local development only), strips hop-by-hop and forwarding headers, and enforces size, rate and time limits on every request - see its own documentation for the specifics.

## Using AFM Safely

A few things worth knowing before you load someone else's agent, or share one of your own:

- **Keep keys out of the file.** Use `${env:NAME}` in `authentication` fields rather than a literal key - a literal value travels with a share link or a downloaded copy of the file, and the app warns you if you try to share one that has one.
- **A key goes only to the address it was entered for.** A key you enter for one server is not sent to another server, to another path on the same host, or to a different token address named in a file.
- **A shared agent runs with your keys**, and reaches whichever servers it names. Read the trust screen it opens with before running it.
- **Tools the agent file lists run without asking. Any other tool call asks first**, and shows which server it goes to and what it sends. Choosing "Always allow" for a tool skips that question from then on for that tool, until the tab is closed.
- **Tool results and attached documents can contain text aimed at the model**, not just at you - treat anything a tool returns or a document contains as untrusted input, the same as you would in any LLM-based tool.
- **Chats are kept in memory for the tab only.** They are gone when you close or refresh it, and deleting an agent from your library deletes its conversation too.
- **Your model provider receives the conversation**, any attachments and any tool results, under your account's own terms with that provider.
- **Voice input is processed by the browser's own speech service**, which for some browsers means audio leaves the device to a vendor server; this interpreter has no part in that.
- **"Sign out" on a server's card ends the sign-in** for that server, dropping both the access and refresh token.

## License

Apache-2.0
