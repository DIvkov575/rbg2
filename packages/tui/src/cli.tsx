#!/usr/bin/env node
/**
 * TUI entry point.
 *
 *   rcsm-tui [--worker ws://127.0.0.1:7890] [--cwd <path>]
 *
 * Connects directly to a single worker (no orchestrator tier yet).
 */

import React from 'react'
import { render } from 'ink'
import { WorkerClient } from './client.js'
import { App } from './App.js'

function parseArgs(argv: string[]): { worker: string; cwd: string } {
  const out = { worker: 'ws://127.0.0.1:7890', cwd: process.cwd() }
  const w = argv.indexOf('--worker')
  if (w !== -1 && argv[w + 1]) out.worker = argv[w + 1]
  const c = argv.indexOf('--cwd')
  if (c !== -1 && argv[c + 1]) out.cwd = argv[c + 1]
  return out
}

const { worker, cwd } = parseArgs(process.argv.slice(2))
const client = new WorkerClient(worker)
render(<App client={client} cwd={cwd} />)
