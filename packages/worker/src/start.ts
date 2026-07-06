/**
 * Worker startup helper — shared by the CLI and any embedding process.
 */

import os from 'node:os'
import path from 'node:path'
import { WorkerServer } from './server.js'
import { log } from './logger.js'

export interface StartWorkerOptions {
  port: number
  dataDir: string
}

const DEFAULT_PORT = 7890
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.rcsm')

/**
 * Start a worker with the given options. Returns the actual bound port
 * (may differ from the requested one if 0 was passed).
 */
export async function startWorker(options: Partial<StartWorkerOptions> = {}): Promise<{
  port: number
  server: WorkerServer
}> {
  // The Agent SDK spawns `claude` as a child process. If CLAUDECODE is set
  // (e.g. when this worker is started from inside a Claude Code session), the
  // child claude process refuses to run ("cannot launch inside another Claude
  // Code session"). Remove it so SDK sessions work unconditionally.
  delete process.env.CLAUDECODE

  const port = options.port ?? DEFAULT_PORT
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR

  const server = new WorkerServer({ port, dataDir })
  const actualPort = await server.start()
  log.server.info('worker listening', { port: actualPort, dataDir })
  return { port: actualPort, server }
}
