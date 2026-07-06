/**
 * Minimal structured JSON-line logger.
 *
 * Replaces open-walnut's larger logging subsystem — we only need a stderr
 * sink stamped with subsystem, level, and message. Level is controlled by
 * LOG_LEVEL (debug|info|warn|error, default info); --verbose maps to debug.
 */

type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
}

function threshold(): number {
  const env = (process.env.LOG_LEVEL ?? 'info').toLowerCase()
  return LEVEL_ORDER[env as Level] ?? LEVEL_ORDER.info
}

function emit(subsystem: string, level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < threshold()) return
  const line = {
    program: 'worker',
    subsystem,
    level,
    msg,
    ts: process.hrtime.bigint().toString(),
    ...fields,
  }
  process.stderr.write(JSON.stringify(line) + '\n')
}

export interface SubsystemLogger {
  debug(msg: string, fields?: Record<string, unknown>): void
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
  fatal(msg: string, fields?: Record<string, unknown>): void
}

function createSubsystemLogger(subsystem: string): SubsystemLogger {
  return {
    debug: (m, f) => emit(subsystem, 'debug', m, f),
    info: (m, f) => emit(subsystem, 'info', m, f),
    warn: (m, f) => emit(subsystem, 'warn', m, f),
    error: (m, f) => emit(subsystem, 'error', m, f),
    fatal: (m, f) => emit(subsystem, 'fatal', m, f),
  }
}

export const log = {
  session: createSubsystemLogger('session'),
  server: createSubsystemLogger('server'),
}
