/**
 * Write Tool
 *
 * Writes content to files. Adapted from OpenCode's write tool.
 */

import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import { createTwoFilesPatch } from "diff"
import { Tool } from "../tool"

export const WRITE_DESCRIPTION = `Writes content to a file on the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path
- Creates parent directories if they don't exist
- ALWAYS prefer editing existing files over creating new ones
- NEVER proactively create documentation files unless explicitly requested`

export const WriteTool = Tool.define("write", {
  description: WRITE_DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to write"),
    content: z.string().describe("The content to write to the file"),
  }),

  async execute(params, ctx) {
    let filepath = params.filePath

    // Resolve relative paths
    if (!path.isAbsolute(filepath)) {
      filepath = path.join(ctx.cwd, filepath)
    }

    const title = path.relative(ctx.cwd, filepath)

    // Get old content if file exists
    let oldContent = ""
    const exists = fs.existsSync(filepath)
    if (exists) {
      oldContent = fs.readFileSync(filepath, "utf-8")
    }

    // Create parent directories if needed
    const dir = path.dirname(filepath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // Generate diff for output
    const diff = createTwoFilesPatch(filepath, filepath, oldContent, params.content)

    // Write the file
    fs.writeFileSync(filepath, params.content)

    return {
      title,
      output: exists
        ? `File updated:\n${diff}`
        : `File created: ${filepath}`,
      metadata: {
        filepath,
        existed: exists,
        diff,
      },
    }
  },
})
