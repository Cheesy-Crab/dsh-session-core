import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { ChatAgentManager } from '../src/manager.js'

const chat = { type: 'group', id: '42' }

/**
 * Minimal DSH host around the real manager: an in-memory store, one fake
 * workspace registry, and an agents service that records every create call.
 */
function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profile-switch-'))
  const writes = []
  const workspaces = []

  const registry = {
    list: () => [...workspaces],
    async create(dir, title) {
      const existing = workspaces.find((workspace) => workspace.path === dir)
      if (existing) return existing
      const workspace = {
        id: `ws-${workspaces.length + 1}`,
        path: dir,
        title,
        sessionIds: [],
        async attachSession(sessionId) {
          if (!this.sessionIds.includes(sessionId)) this.sessionIds.push(sessionId)
        },
      }
      workspaces.push(workspace)
      return workspace
    },
    async delete() {},
  }

  const agents = {
    created: [],
    get: () => undefined,
    async resume() {
      throw new Error('resume should not be used after a profile switch')
    },
    async create(options) {
      const agent = {
        id: options.sessionId,
        cancelled: false,
        cancel() {
          this.cancelled = true
        },
        session: {
          append() {},
        },
      }
      agents.created.push({ options, agent })
      return { agent }
    },
  }

  const ctx = {
    get(name) {
      if (name === 'workspaceRegistry') return registry
      if (name === 'agents') return agents
      return undefined
    },
  }

  const store = {
    load() {},
    get() {
      return undefined
    },
    set(key, value) {
      writes.push({ key, value: { ...value, sessions: { ...value.sessions } } })
    },
  }

  const manager = new ChatAgentManager({
    ctx,
    config: {
      agent: { preset: 'default', provider: 'mock', model: 'mock-model' },
      guestWorkspaceName: 'guest',
      defaultWorkspaceName: 'main',
    },
    root,
    log: () => {},
    send: async () => {},
    sendImage: async () => {},
    store,
  })

  return { root, writes, registry, agents, manager }
}

test('profile switch starts a new session with the new preset and keeps the workspace', async (t) => {
  const h = harness()
  t.after(() => fs.rmSync(h.root, { recursive: true, force: true }))

  h.manager.setProfile(chat, { id: 'alpha', agentPreset: 'preset-alpha' })
  const state = h.manager.stateFor(chat)

  const firstHandle = await h.manager.openSession(state)
  const firstSessionId = state.sessionId
  const { workspaceId, workspacePath, workspaceName } = state

  assert.equal(h.agents.created.length, 1)
  assert.equal(h.agents.created[0].options.meta.agentPreset, 'preset-alpha')
  assert.equal(state.sessions[workspaceId], firstSessionId)

  h.manager.setProfile(chat, { id: 'beta', agentPreset: 'preset-beta' })

  // The stale session must not be reused, but it is detached, not cancelled.
  assert.equal(state.sessionId, undefined)
  assert.equal(state.handle, undefined)
  assert.equal(state.sessions[workspaceId], undefined)
  assert.equal(firstHandle.agent.cancelled, false)

  // The workspace survives the switch untouched.
  assert.equal(state.workspaceId, workspaceId)
  assert.equal(state.workspacePath, workspacePath)
  assert.equal(state.workspaceName, workspaceName)

  // Override resolution and persistence still work as before.
  assert.deepEqual(await h.manager.profileFor(state), { id: 'beta', agentPreset: 'preset-beta' })
  assert.equal(state.profileId, 'beta')
  const persisted = h.writes.at(-1).value
  assert.equal(persisted.sessionId, undefined)
  assert.equal(persisted.workspaceId, workspaceId)
  assert.equal(persisted.workspacePath, workspacePath)
  assert.equal(persisted.profileId, 'beta')
  assert.equal(persisted.profile.id, 'beta')

  const secondHandle = await h.manager.openSession(state)

  // The next open creates a session with the new preset in the same workspace.
  assert.equal(h.agents.created.length, 2)
  assert.equal(h.agents.created[1].options.meta.agentPreset, 'preset-beta')
  assert.equal(h.agents.created[1].options.meta.cwd, workspacePath)
  assert.notEqual(state.sessionId, firstSessionId)
  assert.equal(state.workspaceId, workspaceId)
  assert.equal(state.workspacePath, workspacePath)
  assert.equal(state.handle, secondHandle)
  assert.equal(state.sessions[workspaceId], state.sessionId)
  assert.equal(h.registry.list().length, 1)
  assert.equal(h.agents.created[0].agent.cancelled, false)
})
