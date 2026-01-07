# Agent Core

A minimal agent harness extracted from [OpenCode](https://github.com/anomalyco/opencode).

This is **not** a fork - it's a standalone, simplified implementation of the core agent loop and tools that power OpenCode. Use it as a foundation for building your own agents.

## What This Is

Agent Core provides:

- **The Loop**: An orchestration system that calls an LLM, executes tool calls, and repeats until the task is complete
- **Built-in Tools**: File operations (read, write, edit), search (glob, grep), and shell commands (bash)
- **System Prompts**: Optimized prompts for coding tasks
- **Streaming Events**: Real-time visibility into agent execution

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      YOUR APPLICATION                        │
│  (CLI, Web Server, Desktop App, etc.)                       │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       AGENT CORE                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    THE LOOP                          │    │
│  │  while not done:                                     │    │
│  │    response = llm(messages, tools)                   │    │
│  │    if tool_calls: execute and continue               │    │
│  │    else: done                                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                              │                               │
│              ┌───────────────┴───────────────┐              │
│              ▼                               ▼              │
│  ┌─────────────────────┐         ┌─────────────────────┐    │
│  │   SYSTEM PROMPT     │         │      TOOLS          │    │
│  │   Instructions for  │         │  bash, read, write  │    │
│  │   the LLM           │         │  edit, glob, grep   │    │
│  └─────────────────────┘         │  + your custom ones │    │
│                                  └─────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    VERCEL AI SDK                             │
│  streamText() + Provider Adapters (@ai-sdk/anthropic, etc.) │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
bun install
```

```typescript
import { createAgent } from "./src"
import { anthropic } from "@ai-sdk/anthropic"

// Create an agent
const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  cwd: process.cwd(),
})

// Run with streaming
for await (const event of agent.run("Create a hello.txt file with 'Hello, World!'")) {
  switch (event.type) {
    case "text-delta":
      process.stdout.write(event.text)
      break
    case "tool-call":
      console.log(`\n[Calling ${event.toolName}]`)
      break
    case "tool-result":
      console.log(`[${event.toolName} completed]`)
      break
    case "done":
      console.log("\n[Done]")
      break
  }
}
```

## Core Concepts

### The Loop

The heart of the agent is a simple loop in `src/loop.ts`:

```typescript
while (step < maxSteps) {
  // 1. Call the LLM with messages and available tools
  const response = await streamText({ model, messages, tools })

  // 2. Process the response
  for await (const event of response.fullStream) {
    // Handle text, tool calls, tool results, etc.
  }

  // 3. If no tool calls, we're done
  if (response.toolCalls.length === 0) {
    return
  }

  // 4. Otherwise, continue with tool results in messages
}
```

### Tools

Tools are defined with a simple interface:

```typescript
import { Tool } from "./src/tool"
import { z } from "zod"

const MyTool = Tool.define("my_tool", {
  description: "What this tool does",
  parameters: z.object({
    input: z.string().describe("The input parameter"),
  }),
  async execute(args, ctx) {
    // Do something
    return {
      title: "Short title",
      output: "Result to show the LLM",
      metadata: { /* structured data for UI */ },
    }
  },
})
```

### Built-in Tools

| Tool | Purpose |
|------|---------|
| `bash` | Execute shell commands |
| `read` | Read file contents |
| `write` | Create/overwrite files |
| `edit` | Modify files with string replacement |
| `glob` | Find files by pattern |
| `grep` | Search file contents |

### Custom Tools

Add your own tools:

```typescript
import { createAgent, builtinTools, Tool } from "./src"
import { z } from "zod"

const FlashFirmware = Tool.define("flash_firmware", {
  description: "Flash firmware to a connected microcontroller",
  parameters: z.object({
    hexFile: z.string().describe("Path to the .hex file"),
    port: z.string().describe("Serial port (e.g., /dev/ttyUSB0)"),
  }),
  async execute(args, ctx) {
    // Your implementation
    return {
      title: "Flashed firmware",
      output: "Successfully flashed to device",
      metadata: { port: args.port },
    }
  },
})

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [...builtinTools, FlashFirmware],
})
```

## File Structure

```
agent-core/
├── src/
│   ├── index.ts          # Main exports + createAgent helper
│   ├── loop.ts           # The agent loop
│   ├── tool.ts           # Tool interface
│   ├── tools/
│   │   ├── index.ts      # Tool exports
│   │   ├── bash.ts       # Shell command execution
│   │   ├── read.ts       # File reading
│   │   ├── write.ts      # File writing
│   │   ├── edit.ts       # File editing with fuzzy matching
│   │   ├── glob.ts       # File pattern matching
│   │   └── grep.ts       # Content search
│   └── prompts/
│       └── index.ts      # System prompts
├── package.json
├── tsconfig.json
└── README.md
```

## Events

The agent emits these events during execution:

| Event | Description |
|-------|-------------|
| `text-delta` | Partial text from the LLM |
| `text-done` | Complete text block |
| `tool-call` | LLM is calling a tool |
| `tool-result` | Tool execution completed |
| `tool-error` | Tool execution failed |
| `step-done` | One LLM turn completed |
| `done` | Agent finished |
| `error` | Unrecoverable error |

## What's NOT Included

This is intentionally minimal. OpenCode has many features that are **not** included here:

- **Web UI / TUI**: Build your own interface
- **Session persistence**: Messages are in-memory only
- **Multiple providers**: Uses AI SDK, add providers as needed
- **Permission system**: Tools run without approval
- **Subagents**: Single agent only
- **Context compaction**: No automatic summarization
- **Branching/forking**: Linear conversation only

## Dependencies

Only three runtime dependencies:

```json
{
  "dependencies": {
    "ai": "^4.0.0",           // Vercel AI SDK
    "@ai-sdk/anthropic": "^2.0.0",  // Provider (swap for others)
    "zod": "^3.23.0"          // Schema validation
  }
}
```

## Adapting for Your Use Case

### 1. Add Domain-Specific Tools

```typescript
// For embedded/maker work:
const tools = [
  ...builtinTools,
  CompileTool,
  FlashTool,
  SerialMonitorTool,
  ReadDatasheetTool,
]
```

### 2. Customize the System Prompt

```typescript
const agent = createAgent({
  model,
  systemPrompt: `You are an embedded systems expert.
    You help with microcontroller programming, circuit debugging,
    and firmware development.

    When working with hardware:
    - Always verify connections before flashing
    - Use conservative clock speeds initially
    - Check power supply voltage`,
})
```

### 3. Wrap with Your UI

```typescript
// Express server example
app.post("/agent", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream")

  for await (const event of agent.run(req.body.message)) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  res.end()
})
```

## License

MIT - Use this code however you want.

## Credits

Core architecture and tools adapted from [OpenCode](https://github.com/anomalyco/opencode) by Anomaly.
