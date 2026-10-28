import assert from 'node:assert/strict'
import test from 'node:test'

import { applyTurnContext } from '../src/manager.js'

test('bridge context keeps access grants separate from profile capabilities', () => {
  const state = {}
  applyTurnContext(state, {
    level: 'L2',
    capabilities: ['image', 'read'],
    imageQuota: 42,
    requester: 'qq:710711549',
    principal: 'private:710711549',
  })
  assert.equal(state.level, 'L2')
  assert.deepEqual(state.capabilities, ['image', 'read'])
  assert.deepEqual(state.accessCapabilities, ['image', 'read'])
  assert.equal(state.imageQuota, 42)
  assert.equal(state.requester, 'qq:710711549')
  assert.equal(state.principal, 'private:710711549')
  assert.equal(state.profileId, undefined)
})

test('bridge context refresh keeps previous principal when omitted', () => {
  const state = { principal: 'group:1', accessCapabilities: ['image'] }
  applyTurnContext(state, { level: 'L1', capabilities: ['image'], requester: 'qq:2' })
  assert.equal(state.principal, 'group:1')
  assert.equal(state.requester, 'qq:2')
})
