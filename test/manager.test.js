import assert from 'node:assert/strict'
import test from 'node:test'

import { ChatAgentManager, SessionService } from '../src/index.js'

test('manager is created through the core session service', () => {
  const service = new SessionService({ log: () => {} })
  const manager = service.createManager({
    ctx: {},
    config: {},
    root: '/tmp/dsh-session-core-test',
    log: () => {},
  })
  assert.ok(manager instanceof ChatAgentManager)
  service.dispose()
})
