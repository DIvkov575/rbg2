/**
 * Session store — in-memory model the TUI renders from.
 *
 * Folds the worker's event stream into per-session state: status, metadata,
 * and a bounded transcript of renderable lines. Pure data; no React here.
 */

import type {
  SessionEventName,
  SessionInitData,
  SessionTextDeltaData,
  SessionToolUseData,
  SessionToolResultData,
  SessionResultData,
  SessionErrorData,
} from '@rcsm/protocol'

export type SessionStatus = 'idle' | 'running' | 'error'

export interface TranscriptLine {
  kind: 'text' | 'tool' | 'tool-result' | 'result' | 'error' | 'system'
  text: string
}

export interface SessionModel {
  sessionId: string
  status: SessionStatus
  cwd?: string
  mode?: string
  model?: string
  lines: TranscriptLine[]
  /** Accumulates streaming text deltas until a turn boundary flushes them. */
  pendingText: string
}

const MAX_LINES = 500

function ensure(map: Map<string, SessionModel>, sessionId: string): SessionModel {
  let s = map.get(sessionId)
  if (!s) {
    s = { sessionId, status: 'idle', lines: [], pendingText: '' }
    map.set(sessionId, s)
  }
  return s
}

function push(s: SessionModel, line: TranscriptLine): void {
  s.lines.push(line)
  if (s.lines.length > MAX_LINES) s.lines.splice(0, s.lines.length - MAX_LINES)
}

function flushText(s: SessionModel): void {
  const t = s.pendingText.trim()
  if (t) push(s, { kind: 'text', text: t })
  s.pendingText = ''
}

/**
 * Apply one worker event to the store. Returns the affected sessionId so the
 * caller can trigger a re-render.
 */
export function applyEvent(
  map: Map<string, SessionModel>,
  name: SessionEventName,
  data: unknown,
): string | undefined {
  const sessionId = (data as { sessionId?: string })?.sessionId
  if (!sessionId) return undefined
  const s = ensure(map, sessionId)

  switch (name) {
  case 'session:init': {
    const d = data as SessionInitData
    s.model = d.model
    s.cwd = d.cwd ?? s.cwd
    s.status = 'running'
    push(s, { kind: 'system', text: `session started · ${d.model ?? 'model?'} · ${d.cwd ?? ''}` })
    break
  }
  case 'session:text-delta': {
    const d = data as SessionTextDeltaData
    s.pendingText += d.delta
    s.status = 'running'
    break
  }
  case 'session:tool-use': {
    const d = data as SessionToolUseData
    flushText(s)
    const input = typeof d.input === 'string' ? d.input : JSON.stringify(d.input)
    push(s, { kind: 'tool', text: `⚙ ${d.name}(${input.slice(0, 120)})` })
    break
  }
  case 'session:tool-result': {
    const d = data as SessionToolResultData
    const text = d.result.replace(/\s+/g, ' ').slice(0, 160)
    push(s, { kind: 'tool-result', text: `↳ ${text}` })
    break
  }
  case 'session:result': {
    const d = data as SessionResultData
    flushText(s)
    const cost = d.cost !== undefined ? ` · $${d.cost.toFixed(4)}` : ''
    push(s, { kind: 'result', text: `● ${d.subtype}${cost}` })
    s.status = d.subtype === 'success' ? 'idle' : 'error'
    break
  }
  case 'session:error': {
    const d = data as SessionErrorData
    flushText(s)
    push(s, { kind: 'error', text: `✗ ${d.error}` })
    s.status = 'error'
    break
  }
  case 'session:compact': {
    flushText(s)
    push(s, { kind: 'system', text: '— context compacted —' })
    break
  }
  case 'session:plan-complete': {
    flushText(s)
    push(s, { kind: 'system', text: '— plan ready —' })
    break
  }
  default:
    break
  }

  return sessionId
}
