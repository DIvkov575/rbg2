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
  /** Route Claude sessions through AWS Bedrock instead of subscription/API-key
   *  auth. Auto-detected as true if CLAUDE_CODE_USE_BEDROCK is already set. */
  bedrock: boolean
  /** AWS region for Bedrock. Falls back to AWS_REGION, then DEFAULT_REGION. */
  region: string
}

const DEFAULT_PORT = 7890
const DEFAULT_DATA_DIR = path.join(os.homedir(), '.rcsm')
const DEFAULT_REGION = 'us-west-2'

/**
 * Configure Bedrock auth for the sessions this worker will spawn.
 *
 * The Agent SDK spawns the `claude` CLI, which reads CLAUDE_CODE_USE_BEDROCK
 * and AWS_REGION from its environment. Since child processes inherit our env,
 * setting these here is all it takes to route every session through Bedrock —
 * AWS credentials still come from the ambient chain (env / profile / SSO).
 */
function configureBedrock(bedrock: boolean, region?: string): { bedrock: boolean; region?: string } {
  const enabled = bedrock || process.env.CLAUDE_CODE_USE_BEDROCK === '1'
  if (!enabled) return { bedrock: false }

  const resolvedRegion = region ?? process.env.AWS_REGION ?? DEFAULT_REGION
  process.env.CLAUDE_CODE_USE_BEDROCK = '1'
  process.env.AWS_REGION = resolvedRegion
  return { bedrock: true, region: resolvedRegion }
}

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
  const { bedrock, region } = configureBedrock(options.bedrock ?? false, options.region)

  const server = new WorkerServer({ port, dataDir })
  const actualPort = await server.start()
  log.server.info('worker listening', {
    port: actualPort,
    dataDir,
    auth: bedrock ? `bedrock (${region})` : 'default',
  })
  return { port: actualPort, server }
}
