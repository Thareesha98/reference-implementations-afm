# AFM TypeScript Runtime

A [Agent-Flavored Markdown (AFM)](https://github.com/wso2/agent-flavored-markdown) interpreter that runs entirely in the browser. There is no server that executes the agent: a `.afm.md` file is loaded into a page, parsed and run inside a Web Worker, and talks directly to the model provider and to the MCP servers the file names. The only server piece is a small, stateless CORS relay (the **MCP proxy**, a separate Ballerina service that is not part of this repository) that lets the page reach MCP servers that send no CORS headers of their own; it stores nothing and logs no requests, but it does carry MCP traffic in transit, including those servers' credentials, tool arguments and results, and OAuth sign-in codes and tokens.

## Features

- **Runs client-side** - the agent loop, tool calls and secret handling all happen in a Web Worker, off the main thread; nothing about the run is sent to WSO2 or to any server other than the model provider, the MCP servers the file itself declares, and the MCP proxy those servers' traffic is relayed through
- **Model providers**: OpenAI and Anthropic
- **MCP tools over Streamable HTTP**, relayed through the MCP proxy (see below) - stdio-transport servers are accepted for compatibility with the other AFM interpreters but cannot run in a browser, and are skipped with a warning
- **OAuth 2.1 (PKCE) sign-in** for MCP servers that require it, with tokens kept in the worker, never on the main thread
- **Remembered keys** - a typed secret can be sealed on the device behind a passkey (WebAuthn PRF), so a reload does not ask again; only sealed keys are encrypted - see Security below for what is not
- **File attachments** - Markdown, plain text and PDF, read and chunked directly in the browser
- A single `interfaces` value is recognised for file compatibility (`webchat`/`webhook`), but the runtime is always one chat surface - there is no console or webhook interface here, unlike the other two interpreters. `skills:` is likewise accepted for compatibility only; this runtime does not load skills

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later
- [pnpm](https://pnpm.io/) 11 or later (`corepack enable` picks up the version pinned in `package.json` automatically)
- An API key for OpenAI or Anthropic - entered into the app when you run an agent, not set as an environment variable

## Quick Start

The app needs two things running side by side: an MCP proxy and the web app itself. Any agent that uses an MCP server will fail to connect its tools without the proxy - it is a mandatory relay, not an optional one. The proxy is a separate Ballerina service that is not part of this repository; start it so that it listens on `http://localhost:8787/` and allows the origin `http://localhost:5173`.

```bash
cd typescript-interpreter
pnpm install

# the app, packages/web/.env.local
echo 'VITE_MCP_PROXY_URL=http://localhost:8787/' > packages/web/.env.local
pnpm --filter @afm/web dev
```

Open `http://localhost:5173/`. From there you can start from a blank agent, pick one of the built-in examples, paste an `.afm.md` file's contents, or open one by URL with `?file=<url>`. The first run asks for a model API key and, for any MCP server that needs one, a sign-in or a token - both stay in the browser tab.

## Configuration

### The web app (`packages/web/.env.local`)

| Variable | Required | Purpose |
|---|---|---|
| `VITE_MCP_PROXY_URL` | Yes, if any agent uses an MCP server | The proxy's URL, e.g. `http://localhost:8787/` in development |
| `VITE_OAUTH_CLIENT_ID_URL` | No | The public URL of AFM's own OAuth Client ID Metadata Document, if the site hosts one; production builds also write this document to `oauth/client-metadata.json`. Without it, the app registers itself with each MCP server that supports Dynamic Client Registration |

Model API keys and MCP credentials are never set via environment variables - they are entered in the app itself.

## Testing

```bash
pnpm run typecheck   # every package
pnpm test            # vitest, every package
pnpm audit           # dependency vulnerabilities
```

`pnpm run check` runs typecheck and tests together. CI (`.github/workflows/typescript-interpreter.yml`) runs all three on every push and pull request that touches this directory.

## Adding a Server to the Directory

Connect tools lists the servers written down in `packages/web/src/mcp-directory.ts`; nothing is fetched from a registry. To add one, append an object to `DIRECTORY_ENTRIES` (order does not matter, the list is sorted when shown):

- `url` is the address the publisher's own documentation gives, and `docsUrl` is the page that prints it.
- `auth` is `{ type: "none" }`, `{ type: "bearer", description }` for a key the person pastes, or `{ type: "oauth2", ... }` for sign-in. Copy `authorizeUrl` and `tokenUrl` from the server's `/.well-known/oauth-authorization-server` document; add `registrationUrl` when it has a `registration_endpoint`, `clientIdMetadata: true` when it sets `client_id_metadata_document_supported`, and `scopes` from its 401 challenge or protected-resource metadata. The endpoints must match that document exactly, because sign-in checks them against it.

`pnpm test` rejects an entry with a duplicate id or address, a non-https URL, or an incomplete sign-in.

## Building for Production

```bash
pnpm --filter @afm/web build       # packages/web/dist - static files for any host
```

The web build is a static site (no server-side rendering) that works on any static host. The only other piece it needs is an MCP proxy reachable at `VITE_MCP_PROXY_URL`, and that proxy has to allow the site's origin.

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

## Security

The agent's plaintext credentials stay in the Web Worker: the main thread never holds one in the clear, and a typed secret lives only for the tab unless the user chooses to seal it behind a device passkey. Saved chats and the agent library are stored in the browser (IndexedDB/localStorage) unencrypted - only sealed keys are encrypted.

The page's Content-Security-Policy has no `unsafe-eval` and a `connect-src` allowlist of exactly `'self'`, `api.openai.com`, `api.anthropic.com`, `raw.githubusercontent.com`, `gist.githubusercontent.com`, and the configured MCP proxy origin. This policy is sent as an HTTP response header on every file the site serves, not only `index.html`: a `<meta>` CSP would not apply to the worker scripts at all (workers are not governed by the CSP of the page that created them), so the real enforcement has to come from the header, on the worker's own response.

The separate MCP proxy is what blocks requests to private/loopback/link-local addresses and plain `http://` targets (SSRF protection, with an opt-out for local development only), strips hop-by-hop and forwarding headers, and enforces size, rate and time limits on every request - see its own documentation for the specifics.

## Using AFM Safely

A few things worth knowing before you load someone else's agent, or share one of your own:

- **Keep keys out of the file.** Use `${env:NAME}` in `authentication` fields rather than a literal key - a literal value travels with a share link or a downloaded copy of the file, and the app warns you if you try to share one that has one.
- **A shared agent runs with your keys**, and reaches whichever servers it names. Read the trust screen it opens with before running it.
- **Every MCP tool call asks first**, and shows which server it goes to and what it sends. Choosing "Always allow" for a tool skips that question from then on for that tool; untick it again on that server's own card to ask again.
- **Tool results and attached documents can contain text aimed at the model**, not just at you - treat anything a tool returns or a document contains as untrusted input, the same as you would in any LLM-based tool.
- **Chats are stored unencrypted in this browser.** Use a private window on a shared computer, and delete the agent from your library when you are done - its conversation goes with it.
- **Your model provider receives the conversation**, any attachments and any tool results, under your account's own terms with that provider.
- **Voice input is processed by the browser's own speech service**, which for some browsers means audio leaves the device to a vendor server; this runtime has no part in that.
- **Notifications are off by default.** If you turn them on, a notification shows the first part of the agent's answer - anyone who can see your screen or lock screen sees that much.
- **"Sign out" on a server's card ends a remembered sign-in** for that server, dropping both the access and refresh token.

## License

Apache-2.0
