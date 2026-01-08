/**
 * Doom Loop Detection
 *
 * Detects when an agent is stuck in a loop:
 * - Repeating the same tool calls
 * - Getting the same errors repeatedly
 * - Not making meaningful progress
 *
 * When detected, injects a system message to help break the loop.
 */

import { CoreMessage } from "ai"

/**
 * Doom loop detection configuration
 */
export interface DoomLoopConfig {
  /** Maximum repeated similar tool calls before warning. Default: 3 */
  maxRepeatedCalls?: number
  /** Maximum repeated errors before warning. Default: 2 */
  maxRepeatedErrors?: number
  /** Window of recent messages to analyze. Default: 10 */
  windowSize?: number
}

/**
 * Result of doom loop check
 */
export interface DoomLoopResult {
  /** Whether a doom loop was detected */
  detected: boolean
  /** Type of loop detected */
  type?: "repeated-calls" | "repeated-errors" | "no-progress"
  /** Description of what was detected */
  description?: string
  /** Suggested intervention message */
  intervention?: string
}

/**
 * Extract tool calls from messages
 */
function extractToolCalls(
  messages: CoreMessage[]
): Array<{ name: string; args: string }> {
  const calls: Array<{ name: string; args: string }> = []

  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "tool-call") {
          calls.push({
            name: part.toolName,
            args: JSON.stringify(part.args),
          })
        }
      }
    }
  }

  return calls
}

/**
 * Extract errors from tool results
 */
function extractErrors(messages: CoreMessage[]): string[] {
  const errors: string[] = []

  for (const msg of messages) {
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "tool-result" && part.isError) {
          errors.push(
            typeof part.result === "string"
              ? part.result
              : JSON.stringify(part.result)
          )
        }
      }
    }
  }

  return errors
}

/**
 * Check for repeated patterns in an array
 */
function findRepeatedPattern<T>(
  items: T[],
  keyFn: (item: T) => string,
  threshold: number
): { repeated: boolean; pattern?: string; count: number } {
  if (items.length < threshold) {
    return { repeated: false, count: 0 }
  }

  // Count occurrences of each pattern
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = keyFn(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  // Check if any pattern exceeds threshold
  for (const [pattern, count] of counts) {
    if (count >= threshold) {
      return { repeated: true, pattern, count }
    }
  }

  return { repeated: false, count: 0 }
}

/**
 * Check messages for doom loop patterns
 */
export function checkDoomLoop(
  messages: CoreMessage[],
  config: DoomLoopConfig = {}
): DoomLoopResult {
  const {
    maxRepeatedCalls = 3,
    maxRepeatedErrors = 2,
    windowSize = 10,
  } = config

  // Only look at recent messages
  const recentMessages = messages.slice(-windowSize)

  // Check for repeated tool calls
  const toolCalls = extractToolCalls(recentMessages)
  const repeatedCalls = findRepeatedPattern(
    toolCalls,
    (call) => `${call.name}:${call.args}`,
    maxRepeatedCalls
  )

  if (repeatedCalls.repeated) {
    return {
      detected: true,
      type: "repeated-calls",
      description: `The same tool call has been made ${repeatedCalls.count} times`,
      intervention: `SYSTEM NOTICE: You appear to be repeating the same action (${repeatedCalls.pattern?.split(":")[0]}) multiple times without progress.

Please:
1. Stop and analyze why the previous attempts didn't work
2. Try a different approach or tool
3. If truly stuck, explain the problem to the user and ask for guidance

Do not repeat the same action again.`,
    }
  }

  // Check for repeated errors
  const errors = extractErrors(recentMessages)
  const repeatedErrors = findRepeatedPattern(
    errors,
    (e) => e.slice(0, 100), // Compare first 100 chars of error
    maxRepeatedErrors
  )

  if (repeatedErrors.repeated) {
    return {
      detected: true,
      type: "repeated-errors",
      description: `The same error has occurred ${repeatedErrors.count} times`,
      intervention: `SYSTEM NOTICE: You are encountering the same error repeatedly: "${repeatedErrors.pattern?.slice(0, 100)}..."

Please:
1. Analyze the root cause of this error
2. Try a completely different approach
3. If the error is about missing files/commands, verify they exist before retrying
4. If stuck, explain the issue to the user

Do not retry the same operation without addressing the underlying issue.`,
    }
  }

  // Check for no progress (many tool calls but all failing)
  if (toolCalls.length >= 5) {
    const errorRate = errors.length / toolCalls.length
    if (errorRate > 0.6) {
      return {
        detected: true,
        type: "no-progress",
        description: `${Math.round(errorRate * 100)}% of recent tool calls have failed`,
        intervention: `SYSTEM NOTICE: Most of your recent tool calls are failing. This suggests a fundamental issue with your approach.

Please:
1. Step back and reconsider the problem
2. Verify your assumptions (file paths, command availability, etc.)
3. Consider asking the user for clarification or help
4. Try simpler operations to understand the environment better

Take a moment to think before your next action.`,
      }
    }
  }

  return { detected: false }
}

/**
 * Create an intervention message to inject into the conversation
 */
export function createInterventionMessage(
  result: DoomLoopResult
): CoreMessage | null {
  if (!result.detected || !result.intervention) {
    return null
  }

  return {
    role: "user",
    content: result.intervention,
  }
}
