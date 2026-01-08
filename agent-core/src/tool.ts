/**
 * Tool System
 *
 * This module defines the interface for tools that the agent can use.
 * Tools are the primary way the agent interacts with the world.
 *
 * Adapted from OpenCode's tool system.
 */

import { z } from "zod"

export namespace Tool {
  /**
   * Context passed to tool execution
   */
  export interface Context {
    /** Current working directory */
    cwd: string
    /** Abort signal for cancellation */
    abort: AbortSignal
    /** Update metadata during execution (for streaming progress) */
    metadata(input: { title?: string; metadata?: Record<string, unknown> }): void
  }

  /**
   * Result returned from tool execution
   */
  export interface Result {
    /** Short title describing what happened */
    title: string
    /** Full output to return to the LLM */
    output: string
    /** Structured metadata for UI/logging */
    metadata: Record<string, unknown>
  }

  /**
   * Tool definition
   */
  export interface Definition<TParams extends z.ZodType = z.ZodType> {
    /** Unique tool identifier */
    id: string
    /** Description shown to the LLM */
    description: string
    /** Zod schema for parameters */
    parameters: TParams
    /** Execute the tool */
    execute(args: z.infer<TParams>, ctx: Context): Promise<Result>
  }

  /**
   * Helper to define a tool with proper typing
   */
  export function define<TParams extends z.ZodType>(
    id: string,
    config: Omit<Definition<TParams>, "id">
  ): Definition<TParams> {
    return {
      id,
      ...config,
    }
  }
}
