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

// Convenience types
import type { LanguageModelV1 } from "ai"
import { Tool } from "./tool"
import { runAgent, runAgentSimple, type AgentEvent, type AgentConfig } from "./loop"
import { builtinTools } from "./tools"
import { createSystemPrompt, BASE_SYSTEM_PROMPT } from "./prompts"

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
}

/**
 * Agent instance with run methods
 */
export interface Agent {
  /** Run the agent with streaming events */
  run(message: string, options?: { abortSignal?: AbortSignal }): AsyncGenerator<AgentEvent>
  /** Run the agent and return final result */
  runSimple(message: string): Promise<{ text: string }>
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
  } = options

  const finalSystemPrompt = systemPrompt ?? createSystemPrompt({
    basePrompt: BASE_SYSTEM_PROMPT,
    cwd,
    additionalInstructions: instructions,
  })

  return {
    async *run(message: string, runOptions?: { abortSignal?: AbortSignal }) {
      const config: AgentConfig = {
        model,
        systemPrompt: finalSystemPrompt,
        tools,
        cwd,
        maxSteps,
        temperature,
        abortSignal: runOptions?.abortSignal,
      }

      yield* runAgent(message, config)
    },

    async runSimple(message: string) {
      const config: AgentConfig = {
        model,
        systemPrompt: finalSystemPrompt,
        tools,
        cwd,
        maxSteps,
        temperature,
      }

      const result = await runAgentSimple(message, config)
      return { text: result.text }
    },
  }
}
