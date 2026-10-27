import assert from 'node:assert/strict'
import test from 'node:test'

import { liveSessionTitle, titleFromEvents } from '../src/titles.js'

test('titleFromEvents takes the newest non-empty title', () => {
  assert.equal(titleFromEvents([]), '')
  assert.equal(titleFromEvents([{ type: 'session/title', data: { title: '  ' } }]), '')
  assert.equal(
    titleFromEvents([
      { type: 'session/title', data: { title: '旧标题' } },
      { type: 'user/message', data: {} },
      { type: 'session/title', data: { title: ' 新标题 ' } },
    ]),
    '新标题',
  )
})

test('liveSessionTitle scans back from the head', () => {
  const events = [
    { seq: 1, type: 'session/title', data: { title: '会话标题' } },
    { seq: 2, type: 'turn/start', data: {} },
    { seq: 3, type: 'turn/end', data: {} },
  ]
  const session = {
    seq: 4,
    eventAt: (seq) => events.find((event) => event.seq === seq),
  }
  assert.equal(liveSessionTitle(session), '会话标题')
})

test('liveSessionTitle falls back to the full snapshot', () => {
  const session = {
    seq: 2,
    snapshotEvents: () => [{ seq: 1, type: 'session/title', data: { title: '兜底标题' } }],
  }
  assert.equal(liveSessionTitle(session), '兜底标题')
  assert.equal(liveSessionTitle(undefined), '')
  assert.equal(liveSessionTitle({ seq: 1, eventAt: () => { throw new Error('boom') } }), '')
})
