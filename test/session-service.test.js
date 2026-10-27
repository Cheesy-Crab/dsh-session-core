import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, name, SessionService, ChatAgentManager } from '../src/index.js'

test('session core is a loadable service plugin', () => {
  const services = new Map()
  const cleanups = []
  const ctx = {
    logger: {},
    get: (key) => services.get(key),
    provide: (key, value) => services.set(key, value),
    effect: (factory) => {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
  assert.equal(name, 'dsh-session-core')
  apply(ctx)
  const service = services.get('sessionService')
  assert.ok(service instanceof SessionService)
  const manager = service.createManager({
    ctx: {},
    config: {},
    root: '/tmp/session-core-test',
    log: () => {},
  })
  assert.ok(manager instanceof ChatAgentManager)
  for (const cleanup of cleanups) cleanup()
})
