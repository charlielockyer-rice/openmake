/**
 * Bash Tool
 *
 * Executes shell commands. Adapted from OpenCode's bash tool.
 */

import { z } from "zod"
import { spawn } from "child_process"
import { Tool } from "../tool"

const MAX_OUTPUT_LENGTH = 30_000
const DEFAULT_TIMEOUT = 2 * 60 * 1000 // 2 minutes

export const BASH_DESCRIPTION = `Executes a bash command with optional timeout.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc.
DO NOT use it for file operations (reading, writing, editing, searching) - use the specialized tools instead.

Usage notes:
- The command argument is required
- You can specify an optional timeout in milliseconds (up to 600000ms / 10 minutes)
- If not specified, commands will timeout after 120000ms (2 minutes)
- If the output exceeds 30000 characters, it will be truncated
- Provide a clear description of what the command does

Avoid using bash for:
- File search: Use glob tool instead
- Content search: Use grep tool instead
- Reading files: Use read tool instead
- Editing files: Use edit tool instead
- Writing files: Use write tool instead`

export const BashTool = Tool.define("bash", {
  description: BASH_DESCRIPTION,
  parameters: z.object({
    command: z.string().describe("The command to execute"),
    timeout: z.number().optional().describe("Optional timeout in milliseconds"),
    description: z
      .string()
      .describe("Clear, concise description of what this command does in 5-10 words"),
  }),

  async execute(params, ctx) {
    const timeout = params.timeout ?? DEFAULT_TIMEOUT

    if (timeout < 0) {
      throw new Error(`Invalid timeout value: ${timeout}. Timeout must be positive.`)
    }

    const proc = spawn(params.command, {
      shell: true,
      cwd: ctx.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let output = ""
    let timedOut = false
    let aborted = false

    const append = (chunk: Buffer) => {
      if (output.length <= MAX_OUTPUT_LENGTH) {
        output += chunk.toString()
        ctx.metadata({
          metadata: { output, description: params.description },
        })
      }
    }

    proc.stdout?.on("data", append)
    proc.stderr?.on("data", append)

    // Handle abort
    const abortHandler = () => {
      aborted = true
      proc.kill()
    }
    ctx.abort.addEventListener("abort", abortHandler, { once: true })

    // Handle timeout
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeout)

    // Wait for completion
    await new Promise<void>((resolve) => {
      proc.once("exit", () => {
        clearTimeout(timeoutTimer)
        ctx.abort.removeEventListener("abort", abortHandler)
        resolve()
      })
      proc.once("error", () => {
        clearTimeout(timeoutTimer)
        ctx.abort.removeEventListener("abort", abortHandler)
        resolve()
      })
    })

    // Build result metadata
    const metadata: string[] = []
    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.slice(0, MAX_OUTPUT_LENGTH)
      metadata.push(`Output truncated (exceeded ${MAX_OUTPUT_LENGTH} chars)`)
    }
    if (timedOut) {
      metadata.push(`Command timed out after ${timeout}ms`)
    }
    if (aborted) {
      metadata.push("Command was aborted")
    }

    if (metadata.length > 0) {
      output += "\n\n<metadata>\n" + metadata.join("\n") + "\n</metadata>"
    }

    return {
      title: params.description,
      output,
      metadata: {
        output,
        exitCode: proc.exitCode,
        description: params.description,
      },
    }
  },
})
