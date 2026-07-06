/**
 * Wire protocol for the remote Claude shell manager.
 *
 * Defines the command/response/event contract between clients (TUI /
 * orchestrator) and a worker that wraps @anthropic-ai/claude-agent-sdk.
 *
 * Wire format (JSON over WebSocket):
 *   Command:  { type: 'cmd', id, method, params }    client → worker
 *   Response: { type: 'res', id, ok, data?, error? }  worker → client
 *   Event:    { type: 'event', sessionId, name, data } worker → client
 *
 * ---------------------------------------------------------------------------
 * Portions of this file are adapted from open-walnut
 * (https://github.com/EvanZhang008/open-walnut), MIT License,
 * Copyright (c) 2026 Walnut Contributors. See NOTICE for details.
 * ---------------------------------------------------------------------------
 */

// ── Wire frames ──

export interface CommandFrame {
  type: 'cmd'
  id: string
  method: string
  params: unknown
}

export interface ResponseFrame {
  type: 'res'
  id: string
  ok: boolean
  data?: unknown
  error?: string
}

export interface EventFrame {
  type: 'event'
  sessionId: string
  name: SessionEventName
  data: unknown
}

export type WireFrame = CommandFrame | ResponseFrame | EventFrame

// ── Command methods & params ──

export type SessionMode = 'bypass' | 'accept' | 'default' | 'plan'

export interface SessionStartParams {
  message: string
  cwd?: string
  mode?: SessionMode
  systemPrompt?: string
  /** Resume an existing SDK session by id. */
  sessionId?: string
}

export interface SessionStartResult {
  sessionId: string
}

export interface SessionSendParams {
  sessionId: string
  message: string
}

export interface SessionInterruptParams {
  sessionId: string
}

export interface SessionSetModeParams {
  sessionId: string
  mode: SessionMode
}

export interface SessionStopParams {
  sessionId: string
}

export interface SessionRespondToQuestionParams {
  sessionId: string
  questionId: string
  answers: Record<string, string>
}

export interface SessionRespondToPermissionParams {
  sessionId: string
  requestId: string
  allow: boolean
  message?: string
}

export interface SessionListResult {
  sessions: SessionInfo[]
}

export interface SessionInfo {
  sessionId: string
  status: 'idle' | 'running' | 'error'
  cwd?: string
  mode?: string
}

export type CommandMethod =
  | 'session.start'
  | 'session.send'
  | 'session.interrupt'
  | 'session.setMode'
  | 'session.stop'
  | 'session.respondToQuestion'
  | 'session.respondToPermission'
  | 'session.list'
  | 'ping'

// ── Event types (worker → client) ──

export type SessionEventName =
  | 'session:init'
  | 'session:text-delta'
  | 'session:tool-use'
  | 'session:tool-result'
  | 'session:ask-question'
  | 'session:permission-request'
  | 'session:plan-complete'
  | 'session:compact'
  | 'session:result'
  | 'session:error'
  | 'session:status'

// ── Event data payloads ──

export interface SessionInitData {
  sessionId: string
  model?: string
  cwd?: string
  tools?: string[]
}

export interface SessionTextDeltaData {
  sessionId: string
  delta: string
}

export interface SessionToolUseData {
  sessionId: string
  toolUseId: string
  name: string
  input: unknown
  /** Set for subagent tool calls. */
  parentToolUseId?: string
}

export interface SessionToolResultData {
  sessionId: string
  toolUseId: string
  result: string
}

export interface SessionAskQuestionData {
  sessionId: string
  questionId: string
  questions: AskQuestionItem[]
}

export interface AskQuestionItem {
  question: string
  header?: string
  options: Array<{ label: string; description?: string }>
  multiSelect?: boolean
}

export interface SessionPermissionRequestData {
  sessionId: string
  requestId: string
  toolName: string
  input: unknown
  suggestions?: string[]
}

export interface SessionPlanCompleteData {
  sessionId: string
  planContent: string
}

export interface SessionCompactData {
  sessionId: string
  trigger?: string
  preTokens?: number
}

export type SessionResultSubtype =
  | 'success'
  | 'error'
  | 'error_max_turns'
  | 'error_max_budget'
  | 'interrupted'

export interface SessionResultData {
  sessionId: string
  result: string
  subtype: SessionResultSubtype
  /** Cumulative cost for the current query (display only — do NOT bill). */
  cost?: number
  /** Billable increment since the last result (net of the per-query watermark;
   *  0 for replays). */
  costDelta?: number
  duration?: number
  usage?: { input_tokens: number; output_tokens: number }
  modelUsage?: Record<string, { input_tokens: number; output_tokens: number }>
}

export interface SessionErrorData {
  sessionId: string
  error: string
}

export interface SessionStatusData {
  sessionId: string
  status: 'running' | 'idle' | 'error'
  activity?: string
}
