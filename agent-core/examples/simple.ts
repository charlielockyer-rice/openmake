/**
 * Simple Agent Example
 *
 * This example shows how to create and run an agent.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=your-key bun run examples/simple.ts
 */

import { createAgent, builtinTools } from "../src"
import { anthropic } from "@ai-sdk/anthropic"

async function main() {
  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Please set ANTHROPIC_API_KEY environment variable")
    process.exit(1)
  }

  // Create the agent
  const agent = createAgent({
    model: anthropic("claude-sonnet-4-20250514"),
    tools: builtinTools,
    cwd: process.cwd(),
    instructions: "You are helping with a demo. Be concise.",
  })

  // Get the task from command line or use default
  const task = process.argv[2] || "List the files in the current directory and tell me what you see."

  console.log(`\n📋 Task: ${task}\n`)
  console.log("─".repeat(50))

  // Run the agent with streaming
  for await (const event of agent.run(task)) {
    switch (event.type) {
      case "text-delta":
        process.stdout.write(event.text)
        break

      case "tool-call":
        console.log(`\n\n🔧 [Calling ${event.toolName}]`)
        break

      case "tool-result":
        console.log(`✅ [${event.toolName} completed]\n`)
        break

      case "tool-error":
        console.log(`❌ [${event.toolName} failed: ${event.error}]\n`)
        break

      case "done":
        console.log("\n\n" + "─".repeat(50))
        console.log("✨ Agent completed")
        break

      case "error":
        console.error("\n❌ Error:", event.error.message)
        break
    }
  }
}

main().catch(console.error)
