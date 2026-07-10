#!/usr/bin/env node
/**
 * Worker CLI entry point.
 *
 *   rcsm-worker [--port 7890] [--host 127.0.0.1] [--data-dir ~/.rcsm] [--bedrock] [--region us-west-2]
 *
 * --bedrock routes Claude sessions through AWS Bedrock (auto-enabled if
 * CLAUDE_CODE_USE_BEDROCK=1 is already in the environment). AWS credentials
 * come from the ambient chain (env / profile / SSO).
 *
 * Prints `{ "port": <n>, "pid": <n> }` on stdout once listening, then stays
 * alive until SIGINT/SIGTERM.
 */

import { startWorker } from './start.js'
import { log } from './logger.js'

function parseArgs(argv: string[]): { port?: number; host?: string; dataDir?: string; bedrock?: boolean; region?: string } {
  const out: { port?: number; host?: string; dataDir?: string; bedrock?: boolean; region?: string } = {}
  const portIdx = argv.indexOf('--port')
  if (portIdx !== -1 && argv[portIdx + 1]) out.port = parseInt(argv[portIdx + 1], 10)
  const hostIdx = argv.indexOf('--host')
  if (hostIdx !== -1 && argv[hostIdx + 1]) out.host = argv[hostIdx + 1]
  const dataDirIdx = argv.indexOf('--data-dir')
  if (dataDirIdx !== -1 && argv[dataDirIdx + 1]) out.dataDir = argv[dataDirIdx + 1]
  if (argv.includes('--bedrock')) out.bedrock = true
  const regionIdx = argv.indexOf('--region')
  if (regionIdx !== -1 && argv[regionIdx + 1]) out.region = argv[regionIdx + 1]
  return out
}

async function main(): Promise<void> {
  const { port, host, dataDir, bedrock, region } = parseArgs(process.argv.slice(2))
  const { port: actualPort } = await startWorker({ port, host, dataDir, bedrock, region })

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
