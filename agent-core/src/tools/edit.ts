/**
 * Edit Tool
 *
 * Performs string replacements in files. Adapted from OpenCode's edit tool.
 * Includes fuzzy matching logic from Cline and Gemini CLI.
 */

import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import { createTwoFilesPatch } from "diff"
import { Tool } from "../tool"

export const EDIT_DESCRIPTION = `Performs exact string replacements in files.

Usage:
- You must read the file first before editing
- Preserve exact indentation (tabs/spaces) from the file
- The edit will FAIL if oldString is not found
- The edit will FAIL if oldString is found multiple times (provide more context or use replaceAll)
- Use replaceAll for renaming variables across the file`

export const EditTool = Tool.define("edit", {
  description: EDIT_DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    oldString: z.string().describe("The text to replace"),
    newString: z.string().describe("The text to replace it with"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences (default false)"),
  }),

  async execute(params, ctx) {
    if (params.oldString === params.newString) {
      throw new Error("oldString and newString must be different")
    }

    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.join(ctx.cwd, filepath)
    }

    const title = path.relative(ctx.cwd, filepath)

    // Handle empty oldString (create new file)
    if (params.oldString === "") {
      const dir = path.dirname(filepath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(filepath, params.newString)
      return {
        title,
        output: `File created: ${filepath}`,
        metadata: { filepath, created: true },
      }
    }

    // Read existing file
    if (!fs.existsSync(filepath)) {
      throw new Error(`File not found: ${filepath}`)
    }

    const stat = fs.statSync(filepath)
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${filepath}`)
    }

    const oldContent = fs.readFileSync(filepath, "utf-8")
    const newContent = replace(oldContent, params.oldString, params.newString, params.replaceAll)

    // Generate diff
    const diff = createTwoFilesPatch(
      filepath,
      filepath,
      normalizeLineEndings(oldContent),
      normalizeLineEndings(newContent)
    )

    // Write updated file
    fs.writeFileSync(filepath, newContent)

    return {
      title,
      output: diff,
      metadata: {
        filepath,
        diff,
      },
    }
  },
})

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n")
}

/**
 * Replacer function type - yields potential matches
 */
type Replacer = (content: string, find: string) => Generator<string, void, unknown>

/**
 * Simple exact match
 */
const SimpleReplacer: Replacer = function* (_content, find) {
  yield find
}

/**
 * Match with trimmed lines (handles whitespace differences)
 */
const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true

    for (let j = 0; j < searchLines.length; j++) {
      const originalTrimmed = originalLines[i + j].trim()
      const searchTrimmed = searchLines[j].trim()

      if (originalTrimmed !== searchTrimmed) {
        matches = false
        break
      }
    }

    if (matches) {
      let matchStartIndex = 0
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1
      }

      let matchEndIndex = matchStartIndex
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length
        if (k < searchLines.length - 1) {
          matchEndIndex += 1
        }
      }

      yield content.substring(matchStartIndex, matchEndIndex)
    }
  }
}

/**
 * Block anchor matching - uses first and last lines as anchors
 */
const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")

  if (searchLines.length < 3) return

  if (searchLines[searchLines.length - 1] === "") {
    searchLines.pop()
  }

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()

  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) continue

    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        let matchStartIndex = 0
        for (let k = 0; k < i; k++) {
          matchStartIndex += originalLines[k].length + 1
        }
        let matchEndIndex = matchStartIndex
        for (let k = i; k <= j; k++) {
          matchEndIndex += originalLines[k].length
          if (k < j) matchEndIndex += 1
        }
        yield content.substring(matchStartIndex, matchEndIndex)
        break
      }
    }
  }
}

/**
 * Whitespace normalized matching
 */
const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim()
  const normalizedFind = normalizeWhitespace(find)

  const lines = content.split("\n")
  for (const line of lines) {
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line
    }
  }

  // Multi-line matches
  const findLines = find.split("\n")
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length)
      if (normalizeWhitespace(block.join("\n")) === normalizedFind) {
        yield block.join("\n")
      }
    }
  }
}

/**
 * Multiple occurrence replacer
 */
const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  let startIndex = 0
  while (true) {
    const index = content.indexOf(find, startIndex)
    if (index === -1) break
    yield find
    startIndex = index + find.length
  }
}

/**
 * Main replace function - tries multiple strategies
 */
function replace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false
): string {
  if (oldString === newString) {
    throw new Error("oldString and newString must be different")
  }

  let notFound = true

  const replacers = [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    MultiOccurrenceReplacer,
  ]

  for (const replacer of replacers) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search)
      if (index === -1) continue

      notFound = false

      if (replaceAll) {
        return content.replaceAll(search, newString)
      }

      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) continue

      return content.substring(0, index) + newString + content.substring(index + search.length)
    }
  }

  if (notFound) {
    throw new Error("oldString not found in content")
  }

  throw new Error(
    "Found multiple matches for oldString. Provide more surrounding lines to identify the correct match, or use replaceAll."
  )
}
