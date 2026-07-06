/**
 * WorkerClient — thin WebSocket client for a single worker.
 *
 * Wraps the wire protocol: request/response RPC keyed by frame id, plus an
 * event subscription for the worker's broadcast event frames. Per our current
 * scope the TUI talks directly to a worker (no orchestrator tier yet).
 */

import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import type {
  CommandFrame,
  ResponseFrame,
  EventFrame,
  WireFrame,
  CommandMethod,
  SessionEventName,
} from '@rcsm/protocol'

let counter = 0
function nextId(): string {
  counter += 1
  return `c${Date.now().toString(36)}-${counter}`
}

export interface WorkerEvent {
  sessionId: string
  name: SessionEventName
  data: unknown
}

export type ConnState = 'connecting' | 'open' | 'closed'

export class WorkerClient extends EventEmitter {
  private ws: WebSocket | null = null
  private pending = new Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void }>()
  private _state: ConnState = 'connecting'

  constructor(private url: string) {
    super()
  }

  get state(): ConnState {
    return this._state
  }

  connect(): void {
    this._state = 'connecting'
    this.emit('state', this._state)

    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.on('open', () => {
      this._state = 'open'
      this.emit('state', this._state)
    })

    ws.on('message', (raw) => {
      let frame: WireFrame
      try {
        frame = JSON.parse(raw.toString()) as WireFrame
      } catch {
        return
      }
      if (frame.type === 'res') {
        this.handleResponse(frame)
      } else if (frame.type === 'event') {
        this.handleEvent(frame)
      }
    })

    ws.on('close', () => {
      this._state = 'closed'
      this.emit('state', this._state)
      // Reject any in-flight requests
      for (const [, p] of this.pending) p.reject(new Error('connection closed'))
      this.pending.clear()
    })

    ws.on('error', (err) => {
      this.emit('error', err)
    })
  }

  private handleResponse(frame: ResponseFrame): void {
    const p = this.pending.get(frame.id)
    if (!p) return
    this.pending.delete(frame.id)
    if (frame.ok) {
      p.resolve(frame.data)
    } else {
      p.reject(new Error(frame.error ?? 'request failed'))
    }
  }

  private handleEvent(frame: EventFrame): void {
    const evt: WorkerEvent = { sessionId: frame.sessionId, name: frame.name, data: frame.data }
    this.emit('event', evt)
  }

  /** Send a command and await its response. */
  request<T = unknown>(method: CommandMethod, params: unknown = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('not connected'))
        return
      }
      const id = nextId()
      const frame: CommandFrame = { type: 'cmd', id, method, params }
      this.pending.set(id, { resolve: resolve as (d: unknown) => void, reject })
      this.ws.send(JSON.stringify(frame))
    })
  }

  close(): void {
    this.ws?.close()
  }
}
