/**
 * Glob Tool
 *
 * Fast file pattern matching. Adapted from OpenCode's glob tool.
 */

import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import { Tool } from "../tool"

export const GLOB_DESCRIPTION = `Fast file pattern matching tool.

- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use when you need to find files by name patterns
- Results are limited to 100 files`

export const GlobTool = Tool.define("glob", {
  description: GLOB_DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z
      .string()
      .optional()
      .describe("Directory to search in. Defaults to current working directory."),
  }),

  async execute(params, ctx) {
    const searchPath = params.path
      ? path.isAbsolute(params.path)
        ? params.path
        : path.resolve(ctx.cwd, params.path)
      : ctx.cwd

    const limit = 100
    const files: { path: string; mtime: number }[] = []
    let truncated = false

    // Use Bun's glob if available, otherwise fall back to manual traversal
    const glob = new Bun.Glob(params.pattern)

    for await (const file of glob.scan({
      cwd: searchPath,
      absolute: true,
      followSymlinks: true,
      onlyFiles: true,
    })) {
      if (files.length >= limit) {
        truncated = true
        break
      }

      try {
        const stat = fs.statSync(file)
        files.push({
          path: file,
          mtime: stat.mtime.getTime(),
        })
      } catch {
        // Skip files we can't stat
      }
    }

    // Sort by modification time (newest first)
    files.sort((a, b) => b.mtime - a.mtime)

    const output: string[] = []
    if (files.length === 0) {
      output.push("No files found")
    } else {
      output.push(...files.map((f) => f.path))
      if (truncated) {
        output.push("")
        output.push("(Results truncated. Use a more specific path or pattern.)")
      }
    }

    return {
      title: path.relative(ctx.cwd, searchPath) || ".",
      output: output.join("\n"),
      metadata: {
        count: files.length,
        truncated,
      },
    }
  },
})
