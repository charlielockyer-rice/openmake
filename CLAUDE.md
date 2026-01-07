# CLAUDE.md - OpenCode Development Guide

## Quick Start

### Running the Development Environment

The web app requires **two servers** running simultaneously. Use the combined command:

```bash
bun run dev:web
```

This starts both the backend API server (port 4096) and frontend dev server (port 3000). Then open http://localhost:3000 in your browser.

**Or run them separately in two terminals:**

**Terminal 1 - Backend API Server (port 4096):**
```bash
cd packages/opencode && bun run ./src/index.ts serve
```

**Terminal 2 - Frontend Dev Server (port 3000):**
```bash
bun run --cwd packages/app dev
```

> **Note:** The `serve` command is not in package.json scripts. You must invoke it directly via the CLI entry point as shown above.

### Running the TUI (Terminal UI)

```bash
bun dev                  # Runs in packages/opencode directory
bun dev <directory>      # Runs against a different directory
bun dev .                # Runs in repo root
```

## Project Architecture

### Monorepo Structure

```
openmake/
├── packages/
│   ├── opencode/        # Core CLI, server, and TUI (main package)
│   ├── app/             # Web UI (SolidJS + Vite)
│   ├── ui/              # Shared component library
│   ├── desktop/         # Tauri native desktop app
│   ├── sdk/js/          # Public JavaScript SDK
│   ├── plugin/          # Plugin system (@opencode-ai/plugin)
│   ├── util/            # Shared utilities (@opencode-ai/util)
│   ├── console/         # Admin console (app, core, mail, function, resource)
│   ├── web/             # Documentation site (Astro)
│   ├── docs/            # Documentation content
│   ├── slack/           # Slack integration
│   ├── function/        # Cloudflare Workers
│   ├── enterprise/      # Enterprise features
│   └── script/          # Build scripts
├── sdks/                # External SDKs (VSCode, etc.)
├── infra/               # Infrastructure-as-code (AWS/Cloudflare via SST)
└── nix/                 # Nix package definitions
```

### Core Package Structure (packages/opencode)

```
src/
├── cli/
│   ├── cmd/             # CLI commands (run, serve, auth, mcp, etc.)
│   │   └── tui/         # Terminal UI (SolidJS + OpenTUI)
│   └── network.ts       # Network configuration utilities
├── server/
│   └── server.ts        # Hono HTTP API server (port 4096)
├── session/             # Session/conversation management
├── provider/            # LLM provider integrations (15+ providers)
├── agent/               # Agent logic and prompts
├── mcp/                 # Model Context Protocol
├── lsp/                 # Language Server Protocol
├── acp/                 # Agent Client Protocol
├── project/             # Project detection and management
├── file/                # File system operations
├── plugin/              # Plugin system
└── permission/          # Permission management
```

### Client-Server Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web UI        │     │   Desktop App   │     │   TUI           │
│   (port 3000)   │     │   (Tauri)       │     │   (terminal)    │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   OpenCode Server       │
                    │   (port 4096)           │
                    │   Hono HTTP API         │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   LLM Providers         │
                    │   (Anthropic, OpenAI,   │
                    │    Google, etc.)        │
                    └─────────────────────────┘
```

## Technology Stack

- **Runtime:** Bun 1.3.5+
- **Language:** TypeScript 5.8.2
- **Frontend:** SolidJS 1.9.10, Vite 7.1.4, TailwindCSS 4.x
- **Backend:** Hono 4.10.7
- **Desktop:** Tauri v2 (Rust + TypeScript)
- **AI SDK:** Vercel AI SDK with 15+ provider adapters
- **Database:** Drizzle ORM (PlanetScale/PostgreSQL)
- **Infrastructure:** SST 3.x (AWS/Cloudflare)

## Key Files

| File | Purpose |
|------|---------|
| `packages/opencode/src/index.ts` | CLI entry point |
| `packages/opencode/src/server/server.ts` | Main API server |
| `packages/opencode/src/cli/cmd/serve.ts` | Headless server command |
| `packages/app/src/app.tsx` | Web app root component |
| `packages/app/src/context/server.tsx` | Server connection context |
| `packages/app/src/context/global-sync.tsx` | Global state sync |

## Common Commands

```bash
# Development
bun install                                    # Install dependencies
bun dev                                        # Run TUI in packages/opencode
bun run --cwd packages/app dev                 # Run web UI dev server
bun run --cwd packages/desktop dev             # Run desktop app (requires Rust)

# Type checking
bun typecheck                                  # Check all packages

# Testing
cd packages/opencode && bun test               # Run tests

# Building
./packages/opencode/script/build.ts --single   # Build for current platform
./packages/opencode/script/build.ts            # Build for all platforms

# SDK regeneration (after API changes)
./script/generate.ts                           # Regenerate SDK
./packages/sdk/js/script/build.ts              # Build JS SDK
```

## Style Guide

Follow these conventions (from STYLE_GUIDE.md):

- Keep logic in single functions unless composable/reusable
- **Avoid:** unnecessary destructuring, `else` statements, `try`/`catch`, `any` type, `let`
- **Prefer:** `.catch()` over `try`/`catch`, single-word variable names, Bun APIs (`Bun.file()`, etc.)
- Use precise types
- Stick to immutable patterns

## Debugging

### Server Debugging
```bash
bun run --inspect=ws://localhost:6499/ ./src/index.ts serve --port 4096
```
Then attach your debugger to `ws://localhost:6499/`.

### TUI Debugging
```bash
bun run --inspect=ws://localhost:6499/ --conditions=browser ./src/index.ts
```

### Attach TUI to Running Server
```bash
opencode attach http://localhost:4096
```

## Git Workflow

- Default branch: `dev`
- PRs should be small and focused
- Link relevant issues
- Run `./script/generate.ts` after API/SDK changes

## Environment Configuration

The web app determines the server URL as follows:
1. `?url=` query parameter (highest priority)
2. `http://localhost:4096` if on opencode.ai domain
3. `window.__OPENCODE__.port` (desktop app)
4. `VITE_OPENCODE_SERVER_HOST` and `VITE_OPENCODE_SERVER_PORT` env vars (dev mode)
5. `window.location.origin` (production)

## Protocol Support

- **MCP (Model Context Protocol):** `src/mcp/` - Tool and resource integration
- **LSP (Language Server Protocol):** `src/lsp/` - Editor integration
- **ACP (Agent Client Protocol):** `src/acp/` - Agent communication

## Helpful Notes

- The TUI is built with SolidJS and [OpenTUI](https://github.com/sst/opentui)
- Use `bun dev spawn` instead of `bun dev` if breakpoints don't work in server code
- Tests cannot be run from repo root; run from individual package directories
- Desktop app requires [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
