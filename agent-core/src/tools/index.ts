/**
 * Tools Index
 *
 * Export all built-in tools.
 */

export { BashTool, BASH_DESCRIPTION } from "./bash"
export { ReadTool, READ_DESCRIPTION } from "./read"
export { WriteTool, WRITE_DESCRIPTION } from "./write"
export { EditTool, EDIT_DESCRIPTION } from "./edit"
export { GlobTool, GLOB_DESCRIPTION } from "./glob"
export { GrepTool, GREP_DESCRIPTION } from "./grep"
export { createTaskTool, type TaskToolConfig } from "./task"

import { BashTool } from "./bash"
import { ReadTool } from "./read"
import { WriteTool } from "./write"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { Tool } from "../tool"

/**
 * All built-in tools
 */
export const builtinTools: Tool.Definition[] = [
  BashTool,
  ReadTool,
  WriteTool,
  EditTool,
  GlobTool,
  GrepTool,
]

/**
 * Create a tool registry with built-in tools plus custom tools
 */
export function createToolRegistry(customTools: Tool.Definition[] = []): Tool.Definition[] {
  return [...builtinTools, ...customTools]
}
