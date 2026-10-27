import assert from 'node:assert/strict'
import test from 'node:test'

import { extractReplyText, replyTextSince, splitText, turnError } from '../src/reply.js'

test('extractReplyText takes the last assistant text', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'first' }] },
    { role: 'user', content: [{ type: 'text', text: 'again' }] },
    { role: 'assistant', content: [{ type: 'tool-call' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'final' }] },
  ]
  assert.equal(extractReplyText(messages), 'final')
})

test('extractReplyText returns empty for tool-only or missing replies', () => {
  assert.equal(extractReplyText([]), '')
  assert.equal(extractReplyText([{ role: 'assistant', content: [{ type: 'tool-call' }] }]), '')
  assert.equal(extractReplyText([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]), '')
})

test('replyTextSince only reads the events in range', () => {
  const session = {
    snapshotEvents: () => [
      { seq: 4, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] } } },
      { seq: 5, type: 'tool/call', data: {} },
      { seq: 6, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'second' }] } } },
      { seq: 7, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'tool-call' }] } } },
    ],
  }
  assert.equal(replyTextSince(session, 3), 'second')
})

test('replyTextSince stays empty for tool-only turns', () => {
  assert.equal(replyTextSince({ snapshotEvents: () => [] }, 0), '')
  assert.equal(
    replyTextSince({ snapshotEvents: () => [{ type: 'assistant/message', data: { message: { content: [{ type: 'tool-call' }] } } }] }, 0),
    '',
  )
  assert.equal(replyTextSince({ snapshotEvents: () => { throw new Error('nope') } }, 0), '')
})

test('splitText keeps short replies intact', () => {
  assert.deepEqual(splitText('short', 100), ['short'])
  assert.deepEqual(splitText('   ', 100), [])
})

test('splitText prefers paragraph breaks', () => {
  const text = 'aaaa\n\nbbbb\n\ncccc'
  const chunks = splitText(text, 6)
  assert.deepEqual(chunks, ['aaaa', 'bbbb', 'cccc'])
})

test('splitText hard-cuts when no break is available', () => {
  assert.deepEqual(splitText('abcdefghij', 4), ['abcd', 'efgh', 'ij'])
})

test('splitText never splits a surrogate pair', () => {
  const text = 'a😀b'
  const chunks = splitText(text, 2)
  assert.equal(chunks.join(''), text)
  assert.equal(chunks.some((chunk) => /[\uD800-\uDBFF]$/.test(chunk)), false)
})

test('turnError reports the last errored turn', () => {
  assert.equal(turnError({ snapshotEvents: () => [] }, 0), undefined)
  assert.equal(
    turnError({ snapshotEvents: () => [{ type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'boom' } } } }] }, 0),
    'boom',
  )
  assert.equal(turnError({ snapshotEvents: () => { throw new Error('nope') } }, 0), undefined)
})
