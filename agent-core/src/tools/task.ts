/**
 * Task Tool - Subagent Spawning
 *
 * Allows the main agent to delegate tasks to specialized sub-agents.
 * Each sub-agent runs independently and returns a result.
 */

import { Tool } from "../tool"
import { z } from "zod"
import { LanguageModelV1 } from "ai"
import { runAgentSimple } from "../loop"
import {
  AGENT_TYPES,
  AgentType,
  filterToolsForAgent,
  getAgentType,
} from "../prompts"
import { builtinTools } from "./index"

/**
 * Configuration for the Task tool
 */
export interface TaskToolConfig {
  /** Model to use for sub-agents */
  model: LanguageModelV1
  /** Working directory */
  cwd: string
  /** Available agent types. Defaults to all built-in types */
  agentTypes?: AgentType[]
  /** Custom tools to make available */
  tools?: Tool.Definition[]
  /** Maximum steps for sub-agents. Default: 50 */
  maxSteps?: number
}

/**
 * Create a Task tool with the given configuration
 */
export function createTaskTool(config: TaskToolConfig): Tool.Definition {
  const {
    model,
    cwd,
    agentTypes = AGENT_TYPES,
    tools = builtinTools,
    maxSteps = 50,
  } = config

  const agentTypeNames = agentTypes.map((a) => a.name)

  return Tool.define("task", {
    description: `Delegate a task to a specialized sub-agent.

Available agent types:
${agentTypes.map((a) => `- ${a.name}: ${a.description ?? "No description"}`).join("\n")}

Use this when:
- A task requires specialized knowledge (e.g., codebase exploration)
- You want to parallelize work
- A task is well-defined and can run independently

The sub-agent will run to completion and return its result.`,

    parameters: z.object({
      agentType: z
        .enum(agentTypeNames as [string, ...string[]])
        .describe("Type of agent to spawn"),
      task: z.string().describe("The task for the sub-agent to perform"),
      context: z
        .string()
        .optional()
        .describe("Additional context to provide to the sub-agent"),
    }),

    async execute(args, ctx) {
      const { agentType, task, context } = args

      // Get agent configuration
      const agent = getAgentType(agentType)
      if (!agent) {
        return {
          title: `Unknown agent type: ${agentType}`,
          output: `Error: Agent type "${agentType}" not found. Available types: ${agentTypeNames.join(", ")}`,
          metadata: { error: true },
        }
      }

      // Filter tools based on agent permissions
      const allowedTools = filterToolsForAgent(tools, agent)

      // Build the prompt
      const fullPrompt = context ? `${context}\n\nTask: ${task}` : task

      ctx.metadata({
        title: `Running ${agentType} agent`,
        metadata: { agentType, taskPreview: task.slice(0, 100) },
      })

      try {
        // Run the sub-agent
        const result = await runAgentSimple(fullPrompt, {
          model,
          systemPrompt: agent.prompt,
          tools: allowedTools,
          cwd,
          maxSteps,
          temperature: agent.temperature,
        })

        return {
          title: `${agentType} agent completed`,
          output: result.text,
          metadata: {
            agentType,
            steps: result.steps,
          },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          title: `${agentType} agent failed`,
          output: `Error running sub-agent: ${message}`,
          metadata: { error: true, agentType },
        }
      }
    },
  })
}
