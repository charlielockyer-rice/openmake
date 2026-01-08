/**
 * Agent Loop
 *
 * This is the heart of the agent - the orchestration loop that:
 * 1. Sends messages to the LLM
 * 2. Receives tool calls
 * 3. Executes tools
 * 4. Returns results to the LLM
 * 5. Repeats until done
 *
 * Adapted from OpenCode's SessionPrompt.loop() and SessionProcessor.
 */

import {
  streamText,
  type CoreMessage,
  type LanguageModelV1,
  tool,
  jsonSchema,
} from "ai"
import { z } from "zod"
import { Tool } from "./tool"
import {
  checkDoomLoop,
  createInterventionMessage,
  type DoomLoopConfig,
} from "./doom-loop"
import {
  compactMessages,
  needsCompaction,
  type CompactionConfig,
} from "./compaction"

/**
 * Events emitted during agent execution
 */
export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "text-done"; text: string }
  | { type: "tool-call"; toolName: string; args: unknown }
  | { type: "tool-result"; toolName: string; result: Tool.Result }
  | { type: "tool-error"; toolName: string; error: string }
  | { type: "step-done"; finishReason: string }
  | { type: "compaction"; originalCount: number; newCount: number }
  | { type: "doom-loop"; loopType: string; description: string }
  | { type: "done"; messages: CoreMessage[]; steps: number }
  | { type: "error"; error: Error }

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** The LLM model to use */
  model: LanguageModelV1
  /** System prompt */
  systemPrompt: string
  /** Available tools */
  tools: Tool.Definition[]
  /** Working directory for tool execution */
  cwd: string
  /** Maximum number of steps (tool call rounds). Default: 100 */
  maxSteps?: number
  /** Temperature for LLM. Default: undefined (use model default) */
  temperature?: number
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal
  /** Enable doom loop detection. Default: false */
  enableDoomLoopDetection?: boolean
  /** Doom loop detection configuration */
  doomLoopConfig?: DoomLoopConfig
  /** Enable context compaction. Default: false */
  enableCompaction?: boolean
  /** Context compaction configuration (model is taken from main config if not provided) */
  compactionConfig?: Partial<CompactionConfig>
}

/**
 * Run the agent loop
 *
 * This is an async generator that yields events as the agent executes.
 * The loop continues until:
 * - The LLM responds without tool calls (task complete)
 * - Maximum steps reached
 * - Abort signal triggered
 * - An unrecoverable error occurs
 */
export async function* runAgent(
  userMessage: string,
  config: AgentConfig
): AsyncGenerator<AgentEvent> {
  const {
    model,
    systemPrompt,
    tools: toolDefs,
    cwd,
    maxSteps = 100,
    temperature,
    abortSignal,
    enableDoomLoopDetection = false,
    doomLoopConfig,
    enableCompaction = false,
    compactionConfig,
  } = config

  // Convert our tool definitions to AI SDK format
  const aiTools: Record<string, ReturnType<typeof tool>> = {}
  for (const t of toolDefs) {
    aiTools[t.id] = tool({
      description: t.description,
      parameters: jsonSchema(z.toJSONSchema(t.parameters) as any),
      execute: async (args) => {
        // Create tool context
        const ctx: Tool.Context = {
          cwd,
          abort: abortSignal ?? new AbortController().signal,
          metadata: () => {}, // No-op for now, can be enhanced for streaming
        }

        try {
          const result = await t.execute(args, ctx)
          return result
        } catch (error) {
          throw error
        }
      },
    })
  }

  // Initialize conversation
  const messages: CoreMessage[] = [
    { role: "user", content: userMessage },
  ]

  let step = 0

  // Main loop
  while (step < maxSteps) {
    step++

    // Check for abort
    if (abortSignal?.aborted) {
      yield { type: "error", error: new Error("Aborted") }
      return
    }

    try {
      // Call the LLM
      const response = await streamText({
        model,
        system: systemPrompt,
        messages,
        tools: aiTools,
        temperature,
        abortSignal,
        maxSteps: 1, // We handle the loop ourselves
      })

      let currentText = ""

      // Process the stream
      for await (const event of response.fullStream) {
        switch (event.type) {
          case "text-delta":
            currentText += event.textDelta
            yield { type: "text-delta", text: event.textDelta }
            break

          case "tool-call":
            yield {
              type: "tool-call",
              toolName: event.toolName,
              args: event.args,
            }
            break

          case "tool-result":
            const result = event.result as Tool.Result
            yield {
              type: "tool-result",
              toolName: event.toolName,
              result,
            }
            break

          case "error":
            // Check if it's a tool error
            if ("toolName" in event) {
              yield {
                type: "tool-error",
                toolName: (event as any).toolName,
                error: String(event.error),
              }
            } else {
              yield { type: "error", error: event.error as Error }
              return
            }
            break

          case "finish":
            if (currentText) {
              yield { type: "text-done", text: currentText }
            }
            yield { type: "step-done", finishReason: event.finishReason ?? "unknown" }
            break
        }
      }

      // Get the final result to update messages
      const result = await response

      // Add assistant message to history
      if (result.text || result.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: result.text || "",
          // @ts-ignore - tool calls are handled by the SDK
          toolCalls: result.toolCalls,
        })
      }

      // Add tool results to history
      for (const toolResult of result.toolResults) {
        messages.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: toolResult.toolCallId,
              toolName: toolResult.toolName,
              result: toolResult.result,
            },
          ],
        })
      }

      // Check if we're done (no tool calls = task complete)
      if (result.toolCalls.length === 0) {
        yield { type: "done", messages, steps: step }
        return
      }

      // Doom loop detection
      if (enableDoomLoopDetection) {
        const doomCheck = checkDoomLoop(messages, doomLoopConfig)
        if (doomCheck.detected) {
          yield {
            type: "doom-loop",
            loopType: doomCheck.type!,
            description: doomCheck.description!,
          }
          // Inject intervention message
          const intervention = createInterventionMessage(doomCheck)
          if (intervention) {
            messages.push(intervention)
          }
        }
      }

      // Context compaction
      if (enableCompaction) {
        const maxTokens = compactionConfig?.maxTokens ?? 100000
        if (needsCompaction(messages, maxTokens)) {
          const originalCount = messages.length
          const compacted = await compactMessages(messages, {
            model,
            cwd,
            ...compactionConfig,
          })
          // Replace messages with compacted version
          messages.length = 0
          messages.push(...compacted)
          yield {
            type: "compaction",
            originalCount,
            newCount: messages.length,
          }
        }
      }

      // Continue the loop for more tool calls
    } catch (error) {
      yield { type: "error", error: error as Error }
      return
    }
  }

  // Max steps reached
  yield {
    type: "error",
    error: new Error(`Max steps (${maxSteps}) reached`),
  }
}

/**
 * Simple helper to run the agent and collect all text output
 */
export async function runAgentSimple(
  userMessage: string,
  config: AgentConfig
): Promise<{ text: string; messages: CoreMessage[]; steps: number }> {
  let text = ""
  let finalMessages: CoreMessage[] = []
  let steps = 0

  for await (const event of runAgent(userMessage, config)) {
    switch (event.type) {
      case "text-delta":
        text += event.text
        break
      case "done":
        finalMessages = event.messages
        steps = event.steps
        break
      case "error":
        throw event.error
    }
  }

  return { text, messages: finalMessages, steps }
}
