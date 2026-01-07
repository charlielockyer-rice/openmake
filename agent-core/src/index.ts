/**
 * Agent Core
 *
 * A minimal agent harness extracted from OpenCode.
 *
 * This module provides:
 * - An agent loop that orchestrates LLM calls and tool execution
 * - Built-in tools for file operations, search, and shell commands
 * - System prompts optimized for coding tasks
 *
 * Usage:
 * ```typescript
 * import { createAgent, builtinTools } from "agent-core"
 * import { anthropic } from "@ai-sdk/anthropic"
 *
 * const agent = createAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   tools: builtinTools,
 *   cwd: process.cwd(),
 * })
 *
 * for await (const event of agent.run("Create a hello world file")) {
 *   console.log(event)
 * }
 * ```
 */

// Re-export everything
export { Tool } from "./tool"
export {
  runAgent,
  runAgentSimple,
  type AgentEvent,
  type AgentConfig,
} from "./loop"
export {
  builtinTools,
  createToolRegistry,
  BashTool,
  ReadTool,
  WriteTool,
  EditTool,
  GlobTool,
  GrepTool,
  createTaskTool,
  type TaskToolConfig,
} from "./tools"
export {
  // Base prompts
  BASE_SYSTEM_PROMPT,
  ANTHROPIC_SYSTEM_PROMPT,
  createSystemPrompt,
  // Agent types
  type AgentType,
  AGENT_TYPES,
  BUILD_AGENT,
  EXPLORE_AGENT,
  EMBEDDED_AGENT,
  COMPACTION_AGENT,
  getAgentType,
  filterToolsForAgent,
  // Agent-specific prompts
  EXPLORE_PROMPT,
  EMBEDDED_PROMPT,
  COMPACTION_PROMPT,
  SUMMARY_PROMPT,
  // Model-specific prompts
  ANTHROPIC_PROMPT,
  BEAST_PROMPT,
  GEMINI_PROMPT,
} from "./prompts"

// Storage
export {
  type Storage,
  type StoredSession,
  MemoryStorage,
  FileStorage,
  generateSessionId,
} from "./storage"

// Compaction
export {
  compactMessages,
  needsCompaction,
  estimateTokens,
  type CompactionConfig,
} from "./compaction"

// Doom loop detection
export {
  checkDoomLoop,
  createInterventionMessage,
  type DoomLoopConfig,
  type DoomLoopResult,
} from "./doom-loop"

// Convenience types
import type { LanguageModelV1 } from "ai"
import { Tool } from "./tool"
import { runAgent, runAgentSimple, type AgentEvent, type AgentConfig } from "./loop"
import { builtinTools, createTaskTool } from "./tools"
import { createSystemPrompt, BASE_SYSTEM_PROMPT, AGENT_TYPES } from "./prompts"
import type { Storage, StoredSession } from "./storage"
import { generateSessionId } from "./storage"
import type { DoomLoopConfig } from "./doom-loop"
import type { CompactionConfig } from "./compaction"

/**
 * Simplified agent configuration
 */
export interface CreateAgentOptions {
  /** The LLM model to use (from @ai-sdk/*) */
  model: LanguageModelV1
  /** Working directory. Defaults to process.cwd() */
  cwd?: string
  /** Tools to make available. Defaults to builtinTools */
  tools?: Tool.Definition[]
  /** System prompt. Defaults to BASE_SYSTEM_PROMPT */
  systemPrompt?: string
  /** Additional instructions to append to system prompt */
  instructions?: string
  /** Maximum steps (tool call rounds). Defaults to 100 */
  maxSteps?: number
  /** Temperature for LLM */
  temperature?: number
  /** Enable subagent Task tool. Default: false */
  enableSubagents?: boolean
  /** Enable doom loop detection. Default: false */
  enableDoomLoopDetection?: boolean
  /** Doom loop detection configuration */
  doomLoopConfig?: DoomLoopConfig
  /** Enable context compaction. Default: false */
  enableCompaction?: boolean
  /** Context compaction configuration */
  compactionConfig?: Partial<CompactionConfig>
  /** Optional storage for session persistence */
  storage?: Storage
  /** Session ID for persistence. Auto-generated if storage provided but no ID given */
  sessionId?: string
}

/**
 * Agent instance with run methods
 */
export interface Agent {
  /** Session ID (for persistence) */
  readonly sessionId: string
  /** Run the agent with streaming events */
  run(message: string, options?: { abortSignal?: AbortSignal }): AsyncGenerator<AgentEvent>
  /** Run the agent and return final result */
  runSimple(message: string): Promise<{ text: string; steps: number }>
  /** Save session to storage (if storage configured) */
  save(): Promise<void>
  /** Load session from storage (if storage configured) */
  load(): Promise<boolean>
}

/**
 * Create an agent instance
 *
 * @example
 * ```typescript
 * import { createAgent } from "agent-core"
 * import { anthropic } from "@ai-sdk/anthropic"
 *
 * const agent = createAgent({
 *   model: anthropic("claude-sonnet-4-20250514"),
 * })
 *
 * // Streaming usage
 * for await (const event of agent.run("Create a hello.txt file")) {
 *   if (event.type === "text-delta") {
 *     process.stdout.write(event.text)
 *   }
 * }
 *
 * // Simple usage
 * const { text } = await agent.runSimple("What files are in this directory?")
 * console.log(text)
 * ```
 */
export function createAgent(options: CreateAgentOptions): Agent {
  const {
    model,
    cwd = process.cwd(),
    tools = builtinTools,
    systemPrompt,
    instructions,
    maxSteps = 100,
    temperature,
    enableSubagents = false,
    enableDoomLoopDetection = false,
    doomLoopConfig,
    enableCompaction = false,
    compactionConfig,
    storage,
    sessionId: providedSessionId,
  } = options

  // Generate session ID if storage is provided but no ID given
  const sessionId = providedSessionId ?? (storage ? generateSessionId() : "default")

  // Build tool set
  let finalTools = [...tools]
  if (enableSubagents) {
    // Add the Task tool for spawning sub-agents
    const taskTool = createTaskTool({
      model,
      cwd,
      agentTypes: AGENT_TYPES,
      tools: builtinTools,
      maxSteps: Math.floor(maxSteps / 2), // Sub-agents get half the steps
    })
    finalTools.push(taskTool)
  }

  const finalSystemPrompt = systemPrompt ?? createSystemPrompt({
    basePrompt: BASE_SYSTEM_PROMPT,
    cwd,
    additionalInstructions: instructions,
  })

  // Session state for persistence
  let storedMessages: import("ai").CoreMessage[] = []
  let metadata: Record<string, unknown> = {}

  return {
    get sessionId() {
      return sessionId
    },

    async *run(message: string, runOptions?: { abortSignal?: AbortSignal }) {
      const config: AgentConfig = {
        model,
        systemPrompt: finalSystemPrompt,
        tools: finalTools,
        cwd,
        maxSteps,
        temperature,
        abortSignal: runOptions?.abortSignal,
        enableDoomLoopDetection,
        doomLoopConfig,
        enableCompaction,
        compactionConfig,
      }

      // Add stored messages as context if we have them
      // (The loop will handle them appropriately)

      for await (const event of runAgent(message, config)) {
        yield event
        // Capture final messages for persistence
        if (event.type === "done") {
          storedMessages = event.messages
        }
      }

      // Auto-save if storage configured
      if (storage) {
        await this.save()
      }
    },

    async runSimple(message: string) {
      const config: AgentConfig = {
        model,
        systemPrompt: finalSystemPrompt,
        tools: finalTools,
        cwd,
        maxSteps,
        temperature,
        enableDoomLoopDetection,
        doomLoopConfig,
        enableCompaction,
        compactionConfig,
      }

      const result = await runAgentSimple(message, config)
      storedMessages = result.messages

      // Auto-save if storage configured
      if (storage) {
        await this.save()
      }

      return { text: result.text, steps: result.steps }
    },

    async save() {
      if (!storage) return

      const session: StoredSession = {
        id: sessionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: storedMessages,
        metadata,
      }

      await storage.save(session)
    },

    async load() {
      if (!storage) return false

      const session = await storage.load(sessionId)
      if (!session) return false

      storedMessages = session.messages
      metadata = session.metadata ?? {}
      return true
    },
  }
}
