/**
 * Read Tool
 *
 * Reads files from the filesystem. Adapted from OpenCode's read tool.
 */

import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import { Tool } from "../tool"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000

export const READ_DESCRIPTION = `Reads a file from the local filesystem.

Usage:
- The filePath parameter must be an absolute path, not a relative path
- By default, reads up to 2000 lines starting from the beginning
- You can optionally specify a line offset and limit for long files
- Any lines longer than 2000 characters will be truncated
- Results are returned with line numbers starting at 1
- Can read image files (returns base64)
- If the file doesn't exist, an error will be returned`

export const ReadTool = Tool.define("read", {
  description: READ_DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to read"),
    offset: z.number().optional().describe("Line number to start reading from (0-based)"),
    limit: z.number().optional().describe("Number of lines to read (defaults to 2000)"),
  }),

  async execute(params, ctx) {
    let filepath = params.filePath

    // Resolve relative paths against cwd
    if (!path.isAbsolute(filepath)) {
      filepath = path.join(ctx.cwd, filepath)
    }

    const title = path.relative(ctx.cwd, filepath)

    // Check if file exists
    if (!fs.existsSync(filepath)) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)

      // Try to suggest similar files
      let suggestions: string[] = []
      try {
        const entries = fs.readdirSync(dir)
        suggestions = entries
          .filter(
            (entry) =>
              entry.toLowerCase().includes(base.toLowerCase()) ||
              base.toLowerCase().includes(entry.toLowerCase())
          )
          .map((entry) => path.join(dir, entry))
          .slice(0, 3)
      } catch {
        // Directory doesn't exist
      }

      if (suggestions.length > 0) {
        throw new Error(
          `File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`
        )
      }
      throw new Error(`File not found: ${filepath}`)
    }

    const stat = fs.statSync(filepath)

    // Handle directories
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${filepath}`)
    }

    // Check for binary files
    const ext = path.extname(filepath).toLowerCase()
    const binaryExtensions = [
      ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".class",
      ".jar", ".war", ".7z", ".bin", ".dat", ".obj", ".o",
      ".a", ".lib", ".wasm", ".pyc", ".pyo",
    ]

    if (binaryExtensions.includes(ext)) {
      throw new Error(`Cannot read binary file: ${filepath}`)
    }

    // Handle images - return base64
    const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]
    if (imageExtensions.includes(ext)) {
      const content = fs.readFileSync(filepath)
      const base64 = content.toString("base64")
      const mimeType = ext === ".png" ? "image/png" :
                       ext === ".gif" ? "image/gif" :
                       ext === ".webp" ? "image/webp" :
                       ext === ".bmp" ? "image/bmp" :
                       "image/jpeg"

      return {
        title,
        output: `Image read successfully. Base64 data: data:${mimeType};base64,${base64.slice(0, 100)}...`,
        metadata: {
          type: "image",
          mimeType,
          size: content.length,
        },
      }
    }

    // Read text file
    const content = fs.readFileSync(filepath, "utf-8")
    const lines = content.split("\n")

    const offset = params.offset ?? 0
    const limit = params.limit ?? DEFAULT_READ_LIMIT

    const selectedLines = lines.slice(offset, offset + limit).map((line) => {
      return line.length > MAX_LINE_LENGTH
        ? line.substring(0, MAX_LINE_LENGTH) + "..."
        : line
    })

    // Format with line numbers
    const formattedLines = selectedLines.map((line, index) => {
      const lineNum = (index + offset + 1).toString().padStart(5, "0")
      return `${lineNum}| ${line}`
    })

    let output = "<file>\n"
    output += formattedLines.join("\n")

    const totalLines = lines.length
    const lastReadLine = offset + selectedLines.length
    const hasMoreLines = totalLines > lastReadLine

    if (hasMoreLines) {
      output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`
    } else {
      output += `\n\n(End of file - total ${totalLines} lines)`
    }
    output += "\n</file>"

    return {
      title,
      output,
      metadata: {
        totalLines,
        readLines: selectedLines.length,
        offset,
      },
    }
  },
})
