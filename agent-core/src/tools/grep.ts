/**
 * Grep Tool
 *
 * Fast content search using ripgrep. Adapted from OpenCode's grep tool.
 * Falls back to built-in search if ripgrep isn't available.
 */

import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import { Tool } from "../tool"

const MAX_LINE_LENGTH = 2000

export const GREP_DESCRIPTION = `Fast content search tool.

- Searches file contents using regular expressions
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files by pattern with the include parameter (e.g., "*.js")
- Returns file paths and line numbers sorted by modification time
- Use when you need to find files containing specific patterns`

export const GrepTool = Tool.define("grep", {
  description: GREP_DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("Directory to search in. Defaults to cwd."),
    include: z.string().optional().describe('File pattern to include (e.g., "*.js")'),
  }),

  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }

    const searchPath = params.path || ctx.cwd

    // Try to use ripgrep if available
    const rgPath = await findRipgrep()

    if (rgPath) {
      return await searchWithRipgrep(rgPath, params, searchPath, ctx)
    }

    // Fall back to built-in search
    return await searchBuiltin(params, searchPath, ctx)
  },
})

async function findRipgrep(): Promise<string | null> {
  // Try common locations
  const candidates = ["rg", "/usr/bin/rg", "/usr/local/bin/rg"]

  for (const candidate of candidates) {
    try {
      const proc = Bun.spawn([candidate, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      await proc.exited
      if (proc.exitCode === 0) {
        return candidate
      }
    } catch {
      // Not found, try next
    }
  }

  return null
}

async function searchWithRipgrep(
  rgPath: string,
  params: { pattern: string; path?: string; include?: string },
  searchPath: string,
  ctx: Tool.Context
): Promise<Tool.Result> {
  const args = ["-nH", "--field-match-separator=|", "--regexp", params.pattern]

  if (params.include) {
    args.push("--glob", params.include)
  }

  args.push(searchPath)

  const proc = Bun.spawn([rgPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const output = await new Response(proc.stdout).text()
  const errorOutput = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  if (exitCode === 1) {
    return {
      title: params.pattern,
      metadata: { matches: 0, truncated: false },
      output: "No matches found",
    }
  }

  if (exitCode !== 0) {
    throw new Error(`ripgrep failed: ${errorOutput}`)
  }

  const lines = output.trim().split(/\r?\n/)
  const matches: {
    path: string
    modTime: number
    lineNum: number
    lineText: string
  }[] = []

  for (const line of lines) {
    if (!line) continue

    const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
    if (!filePath || !lineNumStr || lineTextParts.length === 0) continue

    const lineNum = parseInt(lineNumStr, 10)
    const lineText = lineTextParts.join("|")

    try {
      const stat = fs.statSync(filePath)
      matches.push({
        path: filePath,
        modTime: stat.mtime.getTime(),
        lineNum,
        lineText,
      })
    } catch {
      // Skip files we can't stat
    }
  }

  return formatMatches(matches, params.pattern, ctx)
}

async function searchBuiltin(
  params: { pattern: string; path?: string; include?: string },
  searchPath: string,
  ctx: Tool.Context
): Promise<Tool.Result> {
  const regex = new RegExp(params.pattern)
  const includeGlob = params.include ? new Bun.Glob(params.include) : null

  const matches: {
    path: string
    modTime: number
    lineNum: number
    lineText: string
  }[] = []

  // Walk directory
  async function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      // Skip hidden files and common ignored directories
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue
      }

      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        // Check include pattern
        if (includeGlob && !includeGlob.match(entry.name)) {
          continue
        }

        try {
          const content = fs.readFileSync(fullPath, "utf-8")
          const lines = content.split("\n")

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const stat = fs.statSync(fullPath)
              matches.push({
                path: fullPath,
                modTime: stat.mtime.getTime(),
                lineNum: i + 1,
                lineText: lines[i],
              })
            }
          }
        } catch {
          // Skip files we can't read (binary, etc.)
        }
      }
    }
  }

  await walk(searchPath)

  return formatMatches(matches, params.pattern, ctx)
}

function formatMatches(
  matches: { path: string; modTime: number; lineNum: number; lineText: string }[],
  pattern: string,
  ctx: Tool.Context
): Tool.Result {
  // Sort by modification time
  matches.sort((a, b) => b.modTime - a.modTime)

  const limit = 100
  const truncated = matches.length > limit
  const finalMatches = truncated ? matches.slice(0, limit) : matches

  if (finalMatches.length === 0) {
    return {
      title: pattern,
      metadata: { matches: 0, truncated: false },
      output: "No matches found",
    }
  }

  const outputLines = [`Found ${finalMatches.length} matches`]

  let currentFile = ""
  for (const match of finalMatches) {
    if (currentFile !== match.path) {
      if (currentFile !== "") outputLines.push("")
      currentFile = match.path
      outputLines.push(`${match.path}:`)
    }

    const truncatedText =
      match.lineText.length > MAX_LINE_LENGTH
        ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..."
        : match.lineText

    outputLines.push(`  Line ${match.lineNum}: ${truncatedText}`)
  }

  if (truncated) {
    outputLines.push("")
    outputLines.push("(Results truncated. Use a more specific path or pattern.)")
  }

  return {
    title: pattern,
    metadata: {
      matches: finalMatches.length,
      truncated,
    },
    output: outputLines.join("\n"),
  }
}
