import assert from 'node:assert/strict'
import test from 'node:test'

import { ChatAgentManager } from '../src/manager.js'

function managerWithCapture() {
  const calls = []
  const manager = new ChatAgentManager({
    ctx: {},
    config: {},
    root: '/tmp/session-ready-profile',
    log: () => {},
    send: async () => {},
    sendImage: async () => {},
    store: { load() {}, get() {}, set() {} },
    behavior: { sessionReady: (context) => calls.push(context) },
  })
  return { manager, calls }
}

test('sessionReady receives the predicted effective profile', () => {
  const { manager, calls } = managerWithCapture()
  const agent = {
    session: { meta: { effectiveProfileId: 'image' } },
    __platformProfile: { id: 'image', capabilities: ['image.generate'] },
  }
  manager.applySessionExtensions({ agent }, { chat: { type: 'private', id: '1' } }, {})
  assert.equal(calls[0].profile.id, 'image')
})

test('an explicit profile wins over the agent marker', () => {
  const { manager, calls } = managerWithCapture()
  const agent = {
    session: {},
    __platformProfile: { id: 'image' },
  }
  manager.applySessionExtensions(
    { agent },
    { chat: { type: 'private', id: '1' } },
    { id: 'tavern' },
  )
  assert.equal(calls[0].profile.id, 'tavern')
})
