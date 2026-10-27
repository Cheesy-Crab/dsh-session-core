import assert from 'node:assert/strict'
import test from 'node:test'

import { ChatAgentManager } from '../src/manager.js'

test('conversation profile overrides the global preset', async () => {
  const writes = []
  const store = {
    load() {},
    get() { return undefined },
    set(key, value) { writes.push({ key, value }) },
  }
  const manager = new ChatAgentManager({
    ctx: {},
    config: { agent: { preset: 'default' } },
    root: '/tmp/profile-test',
    log: () => {},
    send: async () => {},
    sendImage: async () => {},
    store,
  })
  const chat = { type: 'group', id: '42' }
  manager.setProfile(chat, { id: 'tavern', agentPreset: 'tavern' })
  assert.equal(manager.stateFor(chat).profileId, 'tavern')
  assert.equal((await manager.profileFor(manager.stateFor(chat))).agentPreset, 'tavern')
  assert.ok(writes.length > 0)
})
