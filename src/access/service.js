import { UserStore } from './users.js'
import { normalizeCapabilities, toolAllowed } from './capabilities.js'
import { atLeast, normalizeLevel } from './levels.js'

/**
 * Core-owned access service. Communication adapters provide the storage
 * location and admin list; lifecycle and policy live here.
 */
export class AccessService {
  constructor({ log } = {}) {
    this.log = log
    this.stores = []
  }

  createStore(options) {
    const store = new UserStore({
      ...options,
      log: options?.log ?? this.log,
    })
    this.stores.push(store)
    return store
  }

  normalizeCapabilities(capabilities) {
    return normalizeCapabilities(capabilities)
  }

  normalizeLevel(level) {
    return normalizeLevel(level)
  }

  atLeast(level, minimum) {
    return atLeast(level, minimum)
  }

  toolAllowed(tool, capabilities) {
    return toolAllowed(tool, capabilities)
  }
}
