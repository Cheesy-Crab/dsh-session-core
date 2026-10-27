import { UserStore } from './users.js'

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
}
