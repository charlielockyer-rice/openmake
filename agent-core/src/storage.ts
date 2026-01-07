/**
 * Storage Layer
 *
 * Provides persistence for sessions and messages.
 * This is optional - agents work fine without storage (in-memory only).
 */

import { CoreMessage } from "ai"

/**
 * A stored session
 */
export interface StoredSession {
  id: string
  createdAt: Date
  updatedAt: Date
  messages: CoreMessage[]
  metadata?: Record<string, unknown>
}

/**
 * Storage interface for session persistence
 */
export interface Storage {
  /** List all session IDs */
  list(): Promise<string[]>

  /** Load a session by ID */
  load(id: string): Promise<StoredSession | null>

  /** Save a session */
  save(session: StoredSession): Promise<void>

  /** Delete a session */
  delete(id: string): Promise<void>
}

/**
 * In-memory storage (default, non-persistent)
 */
export class MemoryStorage implements Storage {
  private sessions = new Map<string, StoredSession>()

  async list(): Promise<string[]> {
    return Array.from(this.sessions.keys())
  }

  async load(id: string): Promise<StoredSession | null> {
    return this.sessions.get(id) ?? null
  }

  async save(session: StoredSession): Promise<void> {
    this.sessions.set(session.id, session)
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id)
  }
}

/**
 * File-based storage
 *
 * Stores sessions as JSON files in a directory.
 * Structure: {baseDir}/{sessionId}.json
 */
export class FileStorage implements Storage {
  constructor(private baseDir: string) {}

  private sessionPath(id: string): string {
    return `${this.baseDir}/${id}.json`
  }

  async list(): Promise<string[]> {
    try {
      const entries = await Array.fromAsync(
        new Bun.Glob("*.json").scan({ cwd: this.baseDir })
      )
      return entries.map((f) => f.replace(".json", ""))
    } catch {
      return []
    }
  }

  async load(id: string): Promise<StoredSession | null> {
    try {
      const file = Bun.file(this.sessionPath(id))
      if (!(await file.exists())) {
        return null
      }
      const data = await file.json()
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      }
    } catch {
      return null
    }
  }

  async save(session: StoredSession): Promise<void> {
    // Ensure directory exists
    await Bun.write(
      this.sessionPath(session.id),
      JSON.stringify(session, null, 2)
    )
  }

  async delete(id: string): Promise<void> {
    try {
      await Bun.file(this.sessionPath(id)).delete()
    } catch {
      // Ignore if doesn't exist
    }
  }
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${timestamp}-${random}`
}
