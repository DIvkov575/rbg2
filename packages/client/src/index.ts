/**
 * @rcsm/client — shared client logic for talking to a worker.
 *
 * Transport-and-UI-agnostic: the WebSocket RPC/event client plus the
 * event-folding session store. Used by both the Ink TUI and the plain CLI.
 */

export { WorkerClient } from './client.js'
export type { ConnState, WorkerEvent } from './client.js'
export { applyEvent } from './store.js'
export type { SessionModel, SessionStatus, TranscriptLine } from './store.js'
