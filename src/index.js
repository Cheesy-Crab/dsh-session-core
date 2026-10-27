import { SessionService } from './service.js'

export { SessionService } from './service.js'
export { ChatAgentManager } from './manager.js'
export * from './paths.js'
export * from './reply.js'
export * from './titles.js'

export const name = 'dsh-session-core'

/**
 * Cordis entry point for the core session service. Every communication
 * adapter depends on this service; capability plugins never see it.
 */
export function apply(ctx, rawConfig = {}) {
  const log = (level, message) => {
    const line = `[session-core] ${message}`
    try {
      const logger = ctx.logger
      const write = logger?.[level]
      if (typeof write === 'function') write.call(logger, line)
    } catch {
      // diagnostics must not break startup
    }
  }
  const service = new SessionService({ log, ...(rawConfig ?? {}) })
  try {
    ctx.provide('sessionService', service)
  } catch (error) {
    log('warn', `could not provide sessionService: ${error?.message ?? error}`)
  }
  ctx.effect?.(() => () => service.dispose())
}
