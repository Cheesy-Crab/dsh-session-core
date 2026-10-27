import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizePrincipal, qqGroupPrincipal, qqPrincipal, webPrincipal } from '../src/access/identity.js'

test('legacy identities normalize into namespaced principals', () => {
  assert.equal(normalizePrincipal('3190660282'), 'qq:3190660282')
  assert.equal(normalizePrincipal('group:369552240'), 'qq-group:369552240')
  assert.equal(normalizePrincipal('qq:42'), 'qq:42')
  assert.equal(normalizePrincipal('qq-group:99'), 'qq-group:99')
  assert.equal(normalizePrincipal('web:user-1'), 'web:user-1')
  assert.equal(normalizePrincipal('user-1'), 'user-1')
  assert.equal(qqPrincipal('42'), 'qq:42')
  assert.equal(qqGroupPrincipal('99'), 'qq-group:99')
  assert.equal(webPrincipal('u1'), 'web:u1')
})
