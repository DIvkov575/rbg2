/**
 * @rcsm/worker — public API.
 *
 * A worker owns this machine's Claude Agent SDK sessions and exposes them
 * over the WebSocket wire protocol defined in @rcsm/protocol.
 */

export { WorkerServer } from './server.js'
export type { WorkerServerOptions } from './server.js'
export { SdkSession } from './sdk-session.js'
export type { SdkSessionOptions, EventEmitter } from './sdk-session.js'
export { StateManager } from './state.js'
export type { PersistedSession, SessionState } from './state.js'
export { CostWatermark, costIncrement } from './cost-watermark.js'
export { startWorker } from './start.js'
export type { StartWorkerOptions } from './start.js'
