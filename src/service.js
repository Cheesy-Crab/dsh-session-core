import { ChatAgentManager } from './manager.js'

/**
 * Core-owned session service. Communication adapters ask this service to create
 * a session manager and inject only surface-specific callbacks; they never
 * construct the manager themselves.
 */
export class SessionService {
  constructor({ log } = {}) {
    this.log = log
    this.managers = []
  }

  createManager(options) {
    const manager = new ChatAgentManager({
      ...options,
      log: options?.log ?? this.log,
    })
    this.managers.push(manager)
    return manager
  }

  dispose() {
    for (const manager of this.managers.splice(0)) {
      try {
        manager.stop?.()
      } catch {
        // session teardown is best effort
      }
    }
  }
}
