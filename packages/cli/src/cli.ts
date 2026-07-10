#!/usr/bin/env node
/**
 * rcsm — plain command-line client for a worker.
 *
 * A scriptable, TTY-free alternative to the Ink TUI. Same protocol, same
 * @rcsm/client under the hood — useful for testing, automation, and piping.
 *
 *   rcsm [--worker ws://127.0.0.1:7890] [--json] <command> [args]
 *
 * Commands:
 *   ping                          liveness check
 *   list | ls                     list sessions
 *   spawn <message> [--cwd <p>] [--mode <m>] [--watch]
 *                                 start a session; --watch streams until the
 *                                 first turn completes
 *   send <id> <message> [--watch] push a follow-up turn
 *   watch [<id>]                  stream events (all sessions, or one) until ^C
 *   kill <id>                     stop a session
 *
 * Global flags:
 *   --worker <url>   worker WebSocket URL (default ws://127.0.0.1:7890,
 *                    or $RCSM_WORKER)
 *   --json           emit machine-readable JSON instead of formatted text
 */

import { WorkerClient, applyEvent, type SessionModel, type WorkerEvent } from '@rcsm/client'
import type {
  SessionListResult,
  SessionInfo,
  SessionMode,
  SessionEventName,
} from '@rcsm/protocol'

// ── Arg parsing ────────────────────────────────────────────────────────────

interface Flags {
  worker: string
  json: boolean
  cwd?: string
  mode?: SessionMode
  watch: boolean
  positionals: string[]
}

function parse(argv: string[]): Flags {
  const f: Flags = {
    worker: process.env.RCSM_WORKER ?? 'ws://127.0.0.1:7890',
    json: false,
    watch: false,
    positionals: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
    case '--worker': f.worker = argv[++i]; break
    case '--json': f.json = true; break
    case '--cwd': f.cwd = argv[++i]; break
    case '--mode': f.mode = argv[++i] as SessionMode; break
    case '--watch': f.watch = true; break
    case '-h': case '--help': f.positionals.push('help'); break
    default: f.positionals.push(a)
    }
  }
  return f
}

// ── Output helpers ───────────────────────────────────────────────────────

function out(flags: Flags, human: string, json: unknown): void {
  console.log(flags.json ? JSON.stringify(json) : human)
}

function fail(msg: string): never {
  console.error(`error: ${msg}`)
  process.exit(1)
}

const STATUS_DOT: Record<string, string> = { idle: '●', running: '◐', error: '✗' }

function fmtLine(kind: string, text: string): string {
  const tag = {
    text: '', tool: '⚙ ', 'tool-result': '↳ ', result: '● ', error: '✗ ', system: '— ',
  }[kind] ?? ''
  return `${tag}${text}`
}

// ── Connection ───────────────────────────────────────────────────────────

async function connect(flags: Flags): Promise<WorkerClient> {
  const c = new WorkerClient(flags.worker)
  c.on('error', () => { /* swallow; connect timeout handles failure */ })
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out connecting to ${flags.worker}`)), 8000)
    c.on('state', (s) => { if (s === 'open') { clearTimeout(t); resolve() } })
    c.connect()
  })
  return c
}

// ── Commands ─────────────────────────────────────────────────────────────

async function cmdPing(c: WorkerClient, flags: Flags): Promise<void> {
  const res = await c.request('ping')
  out(flags, 'pong', res)
}

async function cmdList(c: WorkerClient, flags: Flags): Promise<void> {
  const res = await c.request<SessionListResult>('session.list')
  const sessions = res.sessions as SessionInfo[]
  if (flags.json) { out(flags, '', sessions); return }
  if (sessions.length === 0) { console.log('(no sessions)'); return }
  for (const s of sessions) {
    console.log(`${STATUS_DOT[s.status] ?? '?'} ${s.status.padEnd(7)} ${s.sessionId}  ${s.mode ?? ''}`)
  }
}

async function cmdKill(c: WorkerClient, flags: Flags): Promise<void> {
  const id = flags.positionals[1] ?? fail('kill requires a session id')
  await c.request('session.stop', { sessionId: id })
  out(flags, `killed ${id}`, { ok: true, sessionId: id })
}

/**
 * Stream events to stdout. If `onlyId` is set, filter to that session. If
 * `until` is provided, resolve when it returns true for an event (used by
 * spawn/send --watch to stop after the turn completes).
 */
function streamEvents(
  c: WorkerClient,
  flags: Flags,
  opts: { onlyId?: string; until?: (e: WorkerEvent) => boolean } = {},
): Promise<void> {
  return new Promise((resolve) => {
    const store = new Map<string, SessionModel>()
    c.on('event', (e: WorkerEvent) => {
      if (opts.onlyId && e.sessionId !== opts.onlyId) return
      const before = store.get(e.sessionId)?.lines.length ?? 0
      applyEvent(store, e.name, e.data)
      const model = store.get(e.sessionId)
      if (flags.json) {
        console.log(JSON.stringify({ sessionId: e.sessionId, name: e.name, data: e.data }))
      } else if (model) {
        // Print any newly-appended transcript lines.
        for (const l of model.lines.slice(before)) {
          console.log(`[${e.sessionId.slice(0, 12)}] ${fmtLine(l.kind, l.text)}`)
        }
      }
      if (opts.until && opts.until(e)) resolve()
    })
  })
}

async function cmdSpawn(c: WorkerClient, flags: Flags): Promise<void> {
  const message = flags.positionals[1] ?? fail('spawn requires a message')
  const res = await c.request<{ sessionId: string }>('session.start', {
    message,
    cwd: flags.cwd ?? process.cwd(),
    mode: flags.mode ?? 'bypass',
  })
  out(flags, `started ${res.sessionId}`, res)
  if (flags.watch) {
    await streamEvents(c, flags, {
      onlyId: res.sessionId,
      until: (e) => e.name === 'session:result' || e.name === 'session:error',
    })
  }
}

async function cmdSend(c: WorkerClient, flags: Flags): Promise<void> {
  const id = flags.positionals[1] ?? fail('send requires a session id')
  const message = flags.positionals[2] ?? fail('send requires a message')
  await c.request('session.send', { sessionId: id, message })
  out(flags, `sent to ${id}`, { ok: true, sessionId: id })
  if (flags.watch) {
    await streamEvents(c, flags, {
      onlyId: id,
      until: (e) => e.name === 'session:result' || e.name === 'session:error',
    })
  }
}

async function cmdWatch(c: WorkerClient, flags: Flags): Promise<void> {
  const id = flags.positionals[1]
  if (!flags.json) console.error(`watching ${id ?? 'all sessions'} — ^C to stop`)
  await streamEvents(c, flags, { onlyId: id })  // never resolves; runs until ^C
}

const HELP = `rcsm — command-line client for the Remote Claude Shell Manager worker

Usage:
  rcsm [--worker <url>] [--json] <command> [args]

Commands:
  ping                        liveness check
  list, ls                    list sessions
  spawn <message> [--watch]   start a session (--cwd, --mode; --watch streams
                              until the first turn completes)
  send <id> <message> [--watch]   push a follow-up turn
  watch [<id>]                stream events (all, or one session) until ^C
  kill <id>                   stop a session

Flags:
  --worker <url>   worker URL (default ws://127.0.0.1:7890 or $RCSM_WORKER)
  --json           machine-readable JSON output
  --cwd <path>     working dir for a spawned session
  --mode <mode>    permission mode: bypass | accept | plan | default`

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parse(process.argv.slice(2))
  const cmd = flags.positionals[0]

  if (!cmd || cmd === 'help') { console.log(HELP); process.exit(cmd ? 0 : 1) }

  const c = await connect(flags)
  try {
    switch (cmd) {
    case 'ping': await cmdPing(c, flags); break
    case 'list': case 'ls': await cmdList(c, flags); break
    case 'spawn': await cmdSpawn(c, flags); break
    case 'send': await cmdSend(c, flags); break
    case 'watch': await cmdWatch(c, flags); break
    case 'kill': await cmdKill(c, flags); break
    default: fail(`unknown command: ${cmd} (try 'rcsm help')`)
    }
  } finally {
    // Every command that returns here is done: spawn/send --watch resolve
    // once the turn completes; `watch` blocks forever (until ^C) so it never
    // reaches this point. Close and exit unconditionally.
    c.close()
    process.exit(0)
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err))
})
