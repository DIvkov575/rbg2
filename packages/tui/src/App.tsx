/**
 * App — root Ink component. Two views:
 *   - agents:  list every session with status; navigate + spawn/kill
 *   - session: minimal transcript stream + a prompt input for follow-ups
 */

import React, { useEffect, useReducer, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import type { SessionInfo, SessionListResult } from '@rcsm/protocol'
import { WorkerClient, applyEvent, type ConnState, type SessionModel } from '@rcsm/client'

type View = 'agents' | 'session'

const STATUS_COLOR: Record<string, string> = {
  running: 'yellow',
  idle: 'green',
  error: 'red',
}

export interface AppProps {
  client: WorkerClient
  cwd: string
}

export function App({ client, cwd }: AppProps): React.ReactElement {
  const { exit } = useApp()
  const [, forceRender] = useReducer((n: number) => n + 1, 0)
  const store = useRef(new Map<string, SessionModel>())
  const [view, setView] = useState<View>('agents')
  const [conn, setConn] = useState<ConnState>(client.state)
  const [selected, setSelected] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [composing, setComposing] = useState(false)
  const [status, setStatus] = useState('')
  const [showHelp, setShowHelp] = useState(false)

  // Ordered list of session ids for stable navigation.
  const ids = (): string[] => Array.from(store.current.keys())

  // ── Wire up client ──
  useEffect(() => {
    const onState = (s: ConnState) => {
      setConn(s)
      if (s === 'open') { setStatus('connected'); void refresh() }
    }
    const onReconnecting = ({ attempt, delay }: { attempt: number; delay: number }) => {
      setStatus(`disconnected — reconnecting (attempt ${attempt}, ${Math.round(delay / 1000)}s)…`)
    }
    const onEvent = (evt: { sessionId: string; name: import('@rcsm/protocol').SessionEventName; data: unknown }) => {
      applyEvent(store.current, evt.name, evt.data)
      forceRender()
    }
    client.on('state', onState)
    client.on('reconnecting', onReconnecting)
    client.on('event', onEvent)
    client.connect()
    return () => {
      client.off('state', onState)
      client.off('reconnecting', onReconnecting)
      client.off('event', onEvent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refresh(): Promise<void> {
    try {
      const res = await client.request<SessionListResult>('session.list')
      for (const info of res.sessions as SessionInfo[]) {
        const s = store.current.get(info.sessionId) ?? {
          sessionId: info.sessionId, status: info.status, lines: [], pendingText: '',
        }
        s.status = info.status
        s.cwd = info.cwd ?? s.cwd
        s.mode = info.mode ?? s.mode
        store.current.set(info.sessionId, s)
      }
      forceRender()
    } catch {
      /* ignore */
    }
  }

  async function spawn(): Promise<void> {
    setStatus('starting session…')
    try {
      const res = await client.request<{ sessionId: string }>('session.start', {
        message: 'Hello — introduce yourself in one line.',
        cwd,
        mode: 'bypass',
      })
      setStatus(`started ${res.sessionId}`)
      await refresh()
    } catch (e) {
      setStatus(`start failed: ${(e as Error).message}`)
    }
  }

  async function kill(sessionId: string): Promise<void> {
    try {
      await client.request('session.stop', { sessionId })
      store.current.delete(sessionId)
      setSelected((i) => Math.max(0, Math.min(i, ids().length - 1)))
      forceRender()
    } catch (e) {
      setStatus(`kill failed: ${(e as Error).message}`)
    }
  }

  async function sendPrompt(sessionId: string, text: string): Promise<void> {
    if (!text.trim()) return
    try {
      await client.request('session.send', { sessionId, message: text })
    } catch (e) {
      setStatus(`send failed: ${(e as Error).message}`)
    }
  }

  // ── Input handling ──
  useInput((ch, key) => {
    // Prompt composer captures keys in session view.
    if (composing) {
      if (key.escape) { setComposing(false); setInput(''); return }
      if (key.return) {
        if (activeId) void sendPrompt(activeId, input)
        setInput(''); setComposing(false); return
      }
      if (key.backspace || key.delete) { setInput((s) => s.slice(0, -1)); return }
      if (ch && !key.ctrl && !key.meta) setInput((s) => s + ch)
      return
    }

    if (key.ctrl && ch === 'c') { client.close(); exit(); return }

    // Help overlay: any key dismisses it; '?' toggles it from anywhere.
    if (showHelp) { setShowHelp(false); return }
    if (ch === '?') { setShowHelp(true); return }

    if (view === 'agents') {
      const list = ids()
      if (key.upArrow || ch === 'k') setSelected((i) => Math.max(0, i - 1))
      else if (key.downArrow || ch === 'j') setSelected((i) => Math.min(list.length - 1, i + 1))
      else if (key.return && list[selected]) { setActiveId(list[selected]); setView('session') }
      else if (ch === 'n') void spawn()
      else if (ch === 'x' && list[selected]) void kill(list[selected])
      else if (ch === 'r') void refresh()
      else if (ch === 'q') { client.close(); exit() }
    } else {
      // session view
      if (key.escape || ch === 'q') setView('agents')
      else if (ch === 'i') setComposing(true)
      else if (ch === 'x' && activeId) { void kill(activeId); setView('agents') }
    }
  })

  // ── Render ──
  return (
    <Box flexDirection="column" width="100%">
      <Header conn={conn} view={view} />
      {showHelp
        ? <HelpView />
        : view === 'agents'
          ? <AgentsView store={store.current} selected={selected} />
          : <SessionView session={activeId ? store.current.get(activeId) : undefined} />}
      <Footer view={view} composing={composing} input={input} status={status} showHelp={showHelp} />
    </Box>
  )
}

function HelpView(): React.ReactElement {
  const rows: Array<[string, string]> = [
    ['↑ / ↓ · j / k', 'move selection (agents)'],
    ['enter', 'open selected session'],
    ['n', 'new session'],
    ['x', 'kill selected / current session'],
    ['r', 'refresh session list'],
    ['i', 'compose a prompt (session view)'],
    ['enter / esc', 'send / cancel while composing'],
    ['esc / q', 'back to agents (from session view)'],
    ['?', 'toggle this help'],
    ['q · ctrl-c', 'quit'],
  ]
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold>Keybindings</Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.map(([keys, desc]) => (
          <Box key={keys}>
            <Box width={18}><Text color="cyan">{keys}</Text></Box>
            <Text dimColor>{desc}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}><Text dimColor>Press any key to close.</Text></Box>
    </Box>
  )
}

function Header({ conn, view }: { conn: ConnState; view: View }): React.ReactElement {
  const color = conn === 'open' ? 'green' : conn === 'connecting' ? 'yellow' : 'red'
  return (
    <Box justifyContent="space-between" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>rcsm · {view === 'agents' ? 'agents' : 'session'}</Text>
      <Text color={color}>● {conn}</Text>
    </Box>
  )
}

function AgentsView({ store, selected }: { store: Map<string, SessionModel>; selected: number }): React.ReactElement {
  const sessions = Array.from(store.values())
  if (sessions.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>No sessions. Press </Text><Text color="cyan">n</Text><Text dimColor> to start one.</Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" paddingX={1}>
      {sessions.map((s, i) => {
        const active = i === selected
        const last = s.lines[s.lines.length - 1]?.text ?? ''
        return (
          <Box key={s.sessionId}>
            <Text color={active ? 'cyan' : undefined}>{active ? '❯ ' : '  '}</Text>
            <Text color={STATUS_COLOR[s.status] ?? 'white'}>●</Text>
            <Text> {s.sessionId.slice(0, 22).padEnd(22)} </Text>
            <Text dimColor>{(s.mode ?? '').padEnd(7)} </Text>
            <Text dimColor>{last.slice(0, 40)}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

function SessionView({ session }: { session?: SessionModel }): React.ReactElement {
  if (!session) return <Box paddingX={1}><Text dimColor>session not found</Text></Box>
  const tail = session.lines.slice(-18)
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold>{session.sessionId}</Text>
        <Text color={STATUS_COLOR[session.status] ?? 'white'}> · {session.status}</Text>
        {session.model ? <Text dimColor> · {session.model}</Text> : null}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {tail.map((l, i) => <TranscriptLineView key={i} kind={l.kind} text={l.text} />)}
        {session.pendingText ? <Text>{session.pendingText}</Text> : null}
      </Box>
    </Box>
  )
}

function TranscriptLineView({ kind, text }: { kind: string; text: string }): React.ReactElement {
  const color =
    kind === 'tool' ? 'blue'
      : kind === 'tool-result' ? 'gray'
        : kind === 'result' ? 'green'
          : kind === 'error' ? 'red'
            : kind === 'system' ? 'magenta'
              : undefined
  const dim = kind === 'tool-result' || kind === 'system'
  return <Text color={color} dimColor={dim}>{text}</Text>
}

function Footer(
  { view, composing, input, status, showHelp }:
  { view: View; composing: boolean; input: string; status: string; showHelp: boolean },
): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      {composing
        ? <Text>› {input}<Text inverse> </Text></Text>
        : <Text dimColor>{showHelp ? 'any key to close help' : keyHints(view)}</Text>}
      {status ? <Text dimColor>{status}</Text> : null}
    </Box>
  )
}

function keyHints(view: View): string {
  return view === 'agents'
    ? '↑/↓ move · enter open · n new · x kill · r refresh · ? help · q quit'
    : 'i prompt · x kill · esc back · ? help · (enter send · esc cancel while typing)'
}
