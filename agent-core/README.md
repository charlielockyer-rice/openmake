# Agent Core

A minimal agent harness extracted from [OpenCode](https://github.com/anomalyco/opencode).

This is **not** a fork - it's a standalone, simplified implementation of the core agent loop and tools that power OpenCode. Use it as a foundation for building your own agents.

## What This Is

Agent Core provides:

- **The Loop**: An orchestration system that calls an LLM, executes tool calls, and repeats until the task is complete
- **Built-in Tools**: File operations (read, write, edit), search (glob, grep), and shell commands (bash)
- **Agent Types**: Predefined agent configurations (build, explore, embedded, etc.)
- **Model-Specific Prompts**: Optimized prompts for Anthropic, OpenAI, and Gemini
- **Streaming Events**: Real-time visibility into agent execution
- **Subagents** (optional): Spawn specialized agents for specific tasks
- **Persistence** (optional): Save/restore sessions to disk
- **Context Compaction** (optional): Auto-summarize when context gets too long
- **Doom Loop Detection** (optional): Detect and break out of stuck loops

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
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    THE LOOP                              ││
│  │  while not done:                                         ││
│  │    response = llm(messages, tools)                       ││
│  │    if tool_calls: execute and continue                   ││
│  │    else: done                                            ││
│  └─────────────────────────────────────────────────────────┘│
│              │                               │               │
│  ┌───────────▼───────────┐       ┌──────────▼──────────┐    │
│  │   SYSTEM PROMPTS      │       │      TOOLS          │    │
│  │  • Model-specific     │       │  bash, read, write  │    │
│  │  • Agent-type         │       │  edit, glob, grep   │    │
│  │  • Custom             │       │  + your custom ones │    │
│  └───────────────────────┘       └─────────────────────┘    │
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
cd agent-core
bun install
```

### Testing Without a UI

You can test the agent directly from the command line:

```bash
# Set your API key
export ANTHROPIC_API_KEY=your-key-here

# Run the example
bun run examples/simple.ts "List the files in this directory"

# Or run interactively
bun run examples/simple.ts "Create a hello.txt file with 'Hello World'"
```

### Basic Usage

```typescript
import { createAgent } from "./src"
import { anthropic } from "@ai-sdk/anthropic"

// Create an agent
const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  cwd: process.cwd(),
})

// Run with streaming
for await (const event of agent.run("Create a hello.txt file")) {
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

### Agent Types

Agent types are predefined configurations with specific prompts and tool permissions:

| Type | Purpose | Allowed Tools |
|------|---------|---------------|
| `build` | Primary coding agent | All tools |
| `explore` | Read-only codebase exploration | glob, grep, read, bash |
| `embedded` | Microcontroller development | All tools |
| `compaction` | Summarize conversations | read only |

```typescript
import { EMBEDDED_AGENT, filterToolsForAgent, builtinTools } from "./src"

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  systemPrompt: EMBEDDED_AGENT.prompt,
  tools: filterToolsForAgent(builtinTools, EMBEDDED_AGENT),
})
```

### Model-Specific Prompts

Different prompts optimized for each LLM:

| Prompt | Best For | Style |
|--------|----------|-------|
| `ANTHROPIC_PROMPT` | Claude models | Concise, tool-focused |
| `BEAST_PROMPT` | GPT-4/o1 | Autonomous, thorough |
| `GEMINI_PROMPT` | Gemini models | Structured, workflow-oriented |

```typescript
import { BEAST_PROMPT } from "./src"
import { openai } from "@ai-sdk/openai"

const agent = createAgent({
  model: openai("gpt-4o"),
  systemPrompt: BEAST_PROMPT,
})
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
      metadata: { /* structured data */ },
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
| `compaction` | Context was compacted (summarized) |
| `doom-loop` | Stuck loop detected (with intervention) |
| `done` | Agent finished (includes step count) |
| `error` | Unrecoverable error |

## File Structure

```
agent-core/
├── src/
│   ├── index.ts          # Main exports + createAgent helper
│   ├── loop.ts           # The agent loop
│   ├── tool.ts           # Tool interface
│   ├── storage.ts        # Session persistence (optional)
│   ├── compaction.ts     # Context summarization (optional)
│   ├── doom-loop.ts      # Stuck loop detection (optional)
│   ├── tools/
│   │   ├── index.ts      # Tool exports
│   │   ├── bash.ts       # Shell command execution
│   │   ├── read.ts       # File reading
│   │   ├── write.ts      # File writing
│   │   ├── edit.ts       # File editing with fuzzy matching
│   │   ├── glob.ts       # File pattern matching
│   │   ├── grep.ts       # Content search
│   │   └── task.ts       # Subagent spawning (optional)
│   └── prompts/
│       ├── index.ts      # Prompt exports
│       └── agents.ts     # Agent types & model-specific prompts
├── examples/
│   └── simple.ts         # CLI example
├── package.json
├── tsconfig.json
└── README.md
```

## Adding Custom Tools

```typescript
import { createAgent, builtinTools, Tool } from "./src"
import { z } from "zod"

// Define a custom tool
const FlashFirmware = Tool.define("flash_firmware", {
  description: "Flash firmware to a connected microcontroller",
  parameters: z.object({
    hexFile: z.string().describe("Path to the .hex file"),
    port: z.string().describe("Serial port (e.g., /dev/ttyUSB0)"),
  }),
  async execute(args, ctx) {
    // Your implementation here
    return {
      title: "Flashed firmware",
      output: "Successfully flashed to device",
      metadata: { port: args.port },
    }
  },
})

// Use it
const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: [...builtinTools, FlashFirmware],
})
```

## Creating a Simple Test UI

Here's a minimal REPL for testing:

```typescript
// repl.ts
import { createAgent } from "./src"
import { anthropic } from "@ai-sdk/anthropic"
import * as readline from "readline"

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
})

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

async function chat(message: string) {
  for await (const event of agent.run(message)) {
    if (event.type === "text-delta") {
      process.stdout.write(event.text)
    } else if (event.type === "tool-call") {
      console.log(`\n[${event.toolName}]`)
    }
  }
  console.log("\n")
}

function prompt() {
  rl.question("> ", async (input) => {
    if (input === "exit") {
      rl.close()
      return
    }
    await chat(input)
    prompt()
  })
}

console.log("Agent REPL (type 'exit' to quit)")
prompt()
```

Run with: `bun run repl.ts`

## Optional Features

These features are disabled by default to keep the minimal case simple. Enable them as needed:

### Subagents

Spawn specialized agents for specific tasks:

```typescript
const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  enableSubagents: true,  // Adds the "task" tool
})

// Now the agent can delegate to explore, embedded, compaction agents
```

The main agent gets a `task` tool that can spawn sub-agents with their own specialized prompts and tool restrictions.

### Persistence

Save and restore sessions:

```typescript
import { createAgent, FileStorage } from "./src"

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  storage: new FileStorage("./sessions"),
  sessionId: "my-session",  // Optional, auto-generated if not provided
})

// Load existing session
await agent.load()

// Run (auto-saves after each run)
await agent.runSimple("Continue working on the project")

// Or manually save
await agent.save()
```

Storage adapters:
- `MemoryStorage` - In-memory (default, no persistence)
- `FileStorage` - JSON files in a directory

### Context Compaction

Automatically summarize when context gets too long:

```typescript
const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  enableCompaction: true,
  compactionConfig: {
    maxTokens: 100000,  // Trigger compaction above this
    targetTokens: 20000, // Target size after compaction
  },
})
```

When enabled, the agent will summarize older messages using the compaction agent, preserving recent context while staying within limits.

### Doom Loop Detection

Detect and break out of stuck loops:

```typescript
const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  enableDoomLoopDetection: true,
  doomLoopConfig: {
    maxRepeatedCalls: 3,   // Alert after 3 identical tool calls
    maxRepeatedErrors: 2,  // Alert after 2 identical errors
    windowSize: 10,        // Look at last 10 messages
  },
})

// Handle doom loop events
for await (const event of agent.run("Fix the bug")) {
  if (event.type === "doom-loop") {
    console.log(`Detected ${event.loopType}: ${event.description}`)
  }
}
```

When a doom loop is detected, the agent injects an intervention message to help break the cycle.

### Full-Featured Example

```typescript
import { createAgent, FileStorage } from "./src"
import { anthropic } from "@ai-sdk/anthropic"

const agent = createAgent({
  model: anthropic("claude-sonnet-4-20250514"),
  storage: new FileStorage("./sessions"),
  enableSubagents: true,
  enableCompaction: true,
  enableDoomLoopDetection: true,
})

// Load or start fresh
const loaded = await agent.load()
console.log(loaded ? "Resumed session" : "Started new session")

for await (const event of agent.run("Explore the codebase and fix any bugs")) {
  switch (event.type) {
    case "text-delta":
      process.stdout.write(event.text)
      break
    case "tool-call":
      console.log(`\n[${event.toolName}]`)
      break
    case "compaction":
      console.log(`\n[Compacted ${event.originalCount} → ${event.newCount} messages]`)
      break
    case "doom-loop":
      console.log(`\n[Warning: ${event.description}]`)
      break
    case "done":
      console.log(`\n[Done in ${event.steps} steps]`)
      break
  }
}
```

## What's NOT Included

This is intentionally minimal. OpenCode has many features **not** included here:

- **Web UI / TUI**: Build your own interface
- **Multiple providers**: Uses AI SDK, add providers as needed
- **Permission system**: Tools run without approval
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

## For Other Claude Instances

If you're a Claude instance tasked with building on this:

1. **The Loop** (`src/loop.ts`) is the core - study it first
2. **Tools** follow a simple interface - see `src/tool.ts`
3. **Prompts** are in `src/prompts/` - use agent-specific ones for specialized tasks
4. **Events** are how you get visibility - always handle `text-delta` and `tool-call`
5. **The AI SDK** handles LLM communication - you don't need to implement that

Key things to understand:
- The loop runs until `toolCalls.length === 0` (LLM says it's done)
- Tools return `{ title, output, metadata }` - output goes back to LLM
- System prompts significantly affect behavior - use model-specific ones
- Streaming is built-in - handle events as they arrive

Optional features to study if needed:
- **`src/storage.ts`** - Session persistence with Storage interface
- **`src/compaction.ts`** - Context summarization when limits approached
- **`src/doom-loop.ts`** - Detection of stuck/repeating patterns
- **`src/tools/task.ts`** - Subagent spawning via the Task tool

All optional features follow the same pattern:
- Disabled by default (minimal by default)
- Enabled via config flags (`enableX: true`)
- Have their own config objects for customization
- Emit events for visibility (`compaction`, `doom-loop`)

## License

MIT - Use this code however you want.

## Credits

Core architecture and tools adapted from [OpenCode](https://github.com/anomalyco/opencode) by Anomaly.
