/**
 * Context Compaction
 *
 * When conversations get too long, this module summarizes them
 * to keep context within limits while preserving key information.
 */

import { CoreMessage, LanguageModelV1 } from "ai"
import { runAgentSimple } from "./loop"
import { COMPACTION_PROMPT } from "./prompts"
import { ReadTool } from "./tools"

/**
 * Compaction configuration
 */
export interface CompactionConfig {
  /** LLM model to use for summarization */
  model: LanguageModelV1
  /** Maximum tokens before triggering compaction. Default: 100000 */
  maxTokens?: number
  /** Target tokens after compaction. Default: 20000 */
  targetTokens?: number
  /** Working directory for read tool */
  cwd?: string
}

/**
 * Rough token estimation (characters / 4)
 * This is approximate - different models tokenize differently
 */
export function estimateTokens(messages: CoreMessage[]): number {
  let chars = 0
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          chars += part.text.length
        } else if (part.type === "tool-result") {
          chars += JSON.stringify(part.result).length
        }
      }
    }
  }
  return Math.ceil(chars / 4)
}

/**
 * Format messages for the compaction agent to read
 */
function formatMessagesForSummary(messages: CoreMessage[]): string {
  const parts: string[] = []

  for (const msg of messages) {
    let content = ""
    if (typeof msg.content === "string") {
      content = msg.content
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .map((part) => {
          if (part.type === "text") return part.text
          if (part.type === "tool-call")
            return `[Tool: ${part.toolName}(${JSON.stringify(part.args)})]`
          if (part.type === "tool-result")
            return `[Result: ${JSON.stringify(part.result).slice(0, 500)}...]`
          return ""
        })
        .join("\n")
    }

    if (content) {
      parts.push(`## ${msg.role.toUpperCase()}\n${content}`)
    }
  }

  return parts.join("\n\n---\n\n")
}

/**
 * Compact a conversation by summarizing older messages
 *
 * @returns New message array with summary at the start
 */
export async function compactMessages(
  messages: CoreMessage[],
  config: CompactionConfig
): Promise<CoreMessage[]> {
  const { model, targetTokens = 20000, cwd = process.cwd() } = config

  // Find split point - keep recent messages, summarize older ones
  let recentTokens = 0
  let splitIndex = messages.length

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens([messages[i]])
    if (recentTokens + msgTokens > targetTokens) {
      splitIndex = i + 1
      break
    }
    recentTokens += msgTokens
  }

  // If we can't split meaningfully, just return original
  if (splitIndex <= 1) {
    return messages
  }

  const toSummarize = messages.slice(0, splitIndex)
  const toKeep = messages.slice(splitIndex)

  // Generate summary using the compaction agent
  const formattedHistory = formatMessagesForSummary(toSummarize)
  const prompt = `Please summarize the following conversation history. Focus on:
- What tasks were completed
- What is currently being worked on
- Key decisions made
- Important context that should be preserved

CONVERSATION HISTORY:
${formattedHistory}`

  const result = await runAgentSimple(prompt, {
    model,
    systemPrompt: COMPACTION_PROMPT,
    tools: [ReadTool], // Only read allowed for compaction
    cwd,
    maxSteps: 3,
  })

  // Create a summary message to prepend
  const summaryMessage: CoreMessage = {
    role: "system" as const,
    content: `[CONVERSATION SUMMARY - Earlier messages were compacted to save context]

${result.text}

[END SUMMARY - Recent conversation follows]`,
  }

  return [summaryMessage, ...toKeep]
}

/**
 * Check if messages need compaction
 */
export function needsCompaction(
  messages: CoreMessage[],
  maxTokens: number = 100000
): boolean {
  return estimateTokens(messages) > maxTokens
}
