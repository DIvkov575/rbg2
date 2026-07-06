#!/usr/bin/env node
/**
 * Worker CLI entry point.
 *
 *   rcsm-worker [--port 7890] [--data-dir ~/.rcsm]
 *
 * Prints `{ "port": <n>, "pid": <n> }` on stdout once listening, then stays
 * alive until SIGINT/SIGTERM.
 */

import { startWorker } from './start.js'
import { log } from './logger.js'

function parseArgs(argv: string[]): { port?: number; dataDir?: string } {
  const out: { port?: number; dataDir?: string } = {}
  const portIdx = argv.indexOf('--port')
  if (portIdx !== -1 && argv[portIdx + 1]) out.port = parseInt(argv[portIdx + 1], 10)
  const dataDirIdx = argv.indexOf('--data-dir')
  if (dataDirIdx !== -1 && argv[dataDirIdx + 1]) out.dataDir = argv[dataDirIdx + 1]
  return out
}

async function main(): Promise<void> {
  const { port, dataDir } = parseArgs(process.argv.slice(2))
  const { port: actualPort } = await startWorker({ port, dataDir })

  console.log(JSON.stringify({ port: actualPort, pid: process.pid }))

  const shutdown = () => {
    log.server.info('shutting down worker')
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  log.server.fatal('fatal error in worker', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  })
  console.error('Fatal:', err)
  process.exit(1)
})
