import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { UserStore } from '../src/access/users.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-users-'))
const file = path.join(dir, 'users.json')

test.after(() => fs.rmSync(dir, { recursive: true, force: true }))

test('admins are promoted to L3 on load', () => {
  const store = new UserStore({ file, admins: ['admin-1'] })
  store.load()
  store.ensureAdmins()
  assert.equal(store.levelOf('admin-1'), 'L3')
})

test('invite and bind moves a user to the invited level', () => {
  let now = 1000
  const store = new UserStore({ file: path.join(dir, 'bind.json'), now: () => now })
  store.load()
  const code = store.invite('L2', 60_000)
  assert.match(code, /^\d{6}$/)
  const result = store.bind('user-1', code)
  assert.deepEqual(result, { ok: true, level: 'L2' })
  assert.equal(store.levelOf('user-1'), 'L2')
  assert.equal(store.bind('user-2', code).ok, false)
})

test('invite codes expire', () => {
  let now = 1000
  const store = new UserStore({ file: path.join(dir, 'expire.json'), now: () => now })
  store.load()
  const code = store.invite('L1', 1000)
  now = 5000
  assert.equal(store.bind('user-1', code).ok, false)
})

test('daily turn quota resets per day and stops at the limit', () => {
  let now = Date.parse('2026-10-22T00:00:00Z')
  const store = new UserStore({ file: path.join(dir, 'quota.json'), now: () => now })
  store.load()
  assert.equal(store.recordTurn('user-1', 2).allowed, true)
  assert.equal(store.recordTurn('user-1', 2).allowed, true)
  const third = store.recordTurn('user-1', 2)
  assert.equal(third.allowed, false)
  assert.equal(third.used, 2)
})

test('freeze drops effective level and unfreeze restores it', () => {
  const store = new UserStore({ file: path.join(dir, 'freeze.json') })
  store.load()
  store.setLevel('user-1', 'L2')
  store.freeze('user-1')
  assert.equal(store.levelOf('user-1'), 'L0')
  assert.equal(store.user('user-1').status, 'frozen')
  store.freeze('user-1', false)
  assert.equal(store.levelOf('user-1'), 'L2')
})

test('users persist across store instances', () => {
  const shared = path.join(dir, 'persist.json')
  const first = new UserStore({ file: shared })
  first.load()
  first.setLevel('user-9', 'L3')

  const second = new UserStore({ file: shared })
  second.load()
  assert.equal(second.levelOf('user-9'), 'L3')
})

test('L1/L2 get image by default and capabilities can be granted or revoked', () => {
  const store = new UserStore({ file: path.join(dir, 'caps.json') })
  store.load()
  store.setLevel('user-1', 'L1')
  assert.deepEqual(store.capabilitiesOf('user-1', 'L1'), ['image'])
  assert.deepEqual(store.addCapabilities('user-1', ['read', 'write']), ['read', 'write'])
  assert.deepEqual(store.capabilitiesOf('user-1', 'L1').sort(), ['image', 'read', 'write'])
  assert.deepEqual(store.removeCapabilities('user-1', ['write']), ['read'])
  assert.deepEqual(store.capabilitiesOf('user-1', 'L1').sort(), ['image', 'read'])
  store.removeCapabilities('user-1', ['image'])
  assert.deepEqual(store.capabilitiesOf('user-1', 'L1'), ['read'])
})

test('image quota is allocated and overdraw floors at zero', () => {
  const store = new UserStore({ file: path.join(dir, 'quota.json') })
  store.load()
  assert.equal(store.imageQuotaOf('user-1'), 0)
  assert.equal(store.setImageQuota('user-1', 10), 10)
  const first = store.chargeImageQuota('user-1', 4)
  assert.deepEqual({ spent: first.spent, remaining: first.remaining, overdraw: first.overdraw }, { spent: 4, remaining: 6, overdraw: false })
  const second = store.chargeImageQuota('user-1', 9)
  assert.deepEqual({ spent: second.spent, remaining: second.remaining, overdraw: second.overdraw }, { spent: 9, remaining: 0, overdraw: true })
  assert.equal(store.imageQuotaOf('user-1'), 0)
})

test('capability whitelist merges into stored users', () => {
  const store = new UserStore({ file: path.join(dir, 'whitelist.json') })
  store.load()
  store.setLevel('user-1', 'L1')
  store.addCapabilities('user-1', ['read'])
  store.applyWhitelist({ 'user-1': ['workspace', 'exec'] })
  assert.deepEqual(store.capabilitiesOf('user-1', 'L1').sort(), ['exec', 'image', 'read', 'workspace'])
})
