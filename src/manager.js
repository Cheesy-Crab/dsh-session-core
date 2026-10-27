import fs from 'node:fs'
import path from 'node:path'

import { groupDir, ownsDir, uniquenessKey, userDir, validateName, workspacePath } from './paths.js'
import { extractReplyText, replyTextSince, splitText, turnError } from './reply.js'
import { liveSessionTitle, titleFromEvents } from './titles.js'

const clip = (value, limit = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
const shortId = (id) => {
  const text = String(id ?? '')
  return text.length <= 10 ? text : `…${text.slice(-10)}`
}
const normalizeLabel = (label) => String(label ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 32)
/**
 * DSH stores workspace paths canonicalized (`fs.realpath`: symlinks and
 * junctions resolved) and only keeps a session in a workspace when
 * `realpath(session.cwd) === workspace.path`. A workspace registered through a
 * junction keeps its stale path forever, so attach() rejects every new session
 * and the workspace view loses the old ones.
 * @param {string} dir
 * @returns {string}
 */
const canonicalDir = (dir) => {
  try {
    return fs.realpathSync(dir)
  } catch {
    return dir
  }
}
const mkdirp = (dir) => {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
const derivedShape = (session) => {
  try {
    return session.deriveMessages().map((item) => ({
      role: item.role ?? null,
      parts: (item.content ?? []).map((part) => part.type),
    }))
  } catch {
    return []
  }
}

/**
 * One agent Session per QQ chat, persisted across restarts. The first message
 * provisions the chat's workspace, session, and agent; later messages queue
 * behind the current turn. Workspaces and sessions can be switched through the
 * command layer.
 */
export class ChatAgentManager {
  /**
   * @param {{ ctx: any, config: any, root: string, log: (level: string, message: string) => void,
   *           send: (chat: { type: string, id: string }, text: string) => Promise<unknown>,
   *           store: import('../store.js').JsonStore }} options
   */
  constructor({ ctx, config, root, log, send, sendImage, store, approval, bindSession, resolveChat, behavior }) {
    this.ctx = ctx
    this.config = config
    this.root = root
    this.log = log
    this.send = send
    this.sendImage = sendImage
    this.store = store
    this.approval = approval
    this.bindSession = bindSession
    this.resolveChat = resolveChat
    this.behavior = behavior ?? {}
    this.chats = new Map()
    /** Last sequence delivered to QQ, per session. */
    this.delivered = new WeakMap()
  }

  init() {
    this.store.load()
  }

  stateFor(chat) {
    const key = `${chat.type}:${chat.id}`
    let state = this.chats.get(key)
    if (!state) {
      const saved = this.store.get(key)
      state = {
        key,
        chat,
        chain: Promise.resolve(),
        pending: 0,
        opening: undefined,
        workspaceId: saved?.workspaceId,
        workspacePath: saved?.workspacePath,
        workspaceName: saved?.workspaceName,
        sessionId: saved?.sessionId,
        sessions: saved?.sessions ?? {},
        labels: saved?.labels ?? {},
        titles: saved?.titles ?? {},
        archived: saved?.archived ?? [],
        guest: false,
        level: 'L1',
        capabilities: [],
        handle: undefined,
      }
      this.chats.set(key, state)
    }
    return state
  }

  persist(state) {
    if (state.guest) return
    this.store.set(state.key, {
      workspaceId: state.workspaceId,
      workspacePath: state.workspacePath,
      workspaceName: state.workspaceName,
      sessionId: state.sessionId,
      sessions: state.sessions,
      labels: state.labels,
      titles: state.titles ?? {},
      archived: state.archived,
      updatedAt: Date.now(),
    })
  }

  setContext(chat, { level = 'L1', capabilities = [], imageQuota } = {}) {
    const state = this.stateFor(chat)
    state.level = level
    state.capabilities = capabilities
    if (imageQuota !== undefined) state.imageQuota = imageQuota
    return state
  }

  services() {
    const workspaceRegistry = this.ctx.get('workspaceRegistry')
    const agents = this.ctx.get('agents')
    const approval = this.ctx.get('approval')
    if (!workspaceRegistry || !agents) throw new Error('DSH 服务尚未就绪，请稍后再试')
    return { workspaceRegistry, agents, approval }
  }

  agentOptions() {
    return { provider: this.config.agent.provider, model: this.config.agent.model }
  }

  /**
   * Mount the configured agent preset (tools/prompt/skills). Raw
   * `agents.create` does not select one, which leaves the agent with only
   * host-global tools such as `working_directory`.
   * @param {any} agent
   */
  /**
   * Tell the agent that images only reach QQ when they go through `present`.
   * Without this, models often write a file path in prose and believe it was sent.
   */
  applySessionExtensions(handle, state) {
    return this.behavior.sessionReady?.({
      agent: handle.agent,
      session: handle.agent.session,
      chat: state.chat,
      state,
      level: state.level ?? 'L1',
      sendText: this.send,
      sendImage: this.sendImage,
      log: this.log,
    })
  }

  async ensurePreset(agent) {
    const preset = this.config.agent.preset
    const presets = this.ctx.get('agentPresets')
    if (!preset || !presets) return
    try {
      if (presets.composedPreset?.(agent.ctx) === preset) return
      if (presets.composedPreset?.(agent.ctx) === undefined && typeof presets.recompose === 'function') {
        await presets.recompose(agent.ctx, preset)
      } else {
        await presets.select(agent, preset)
      }
      this.log('info', `agent preset ${preset} mounted for ${agent.id}`)
    } catch (error) {
      this.log('warn', `agent preset ${preset} was not applied: ${error?.message ?? error}`)
    }
  }

  async ensureWorkspace(state) {
    const { workspaceRegistry } = this.services()
    const level = state.level ?? 'L1'

    if (state.chat.type === 'group') {
      const dir = canonicalDir(mkdirp(groupDir(this.root, state.chat.id)))
      const workspace = await workspaceRegistry.create(dir, `QQ Group ${state.chat.id}`)
      state.guest = false
      state.workspaceId = workspace.id
      state.workspacePath = workspace.path
      state.workspaceName = workspace.title
      return workspace
    }

    if (level === 'L0') {
      const dir = canonicalDir(mkdirp(path.join(this.root, this.config.guestWorkspaceName)))
      const workspace = await workspaceRegistry.create(dir, 'Guest')
      state.guest = true
      state.workspaceId = workspace.id
      state.workspacePath = workspace.path
      state.workspaceName = workspace.title
      return workspace
    }

    if (state.guest) {
      state.guest = false
      state.workspaceId = undefined
      state.workspacePath = undefined
      state.workspaceName = undefined
      state.sessionId = undefined
      state.sessions = {}
      state.handle = undefined
    }

    const workspaces = workspaceRegistry.list()

    let workspace = state.workspaceId ? workspaces.find((item) => item.id === state.workspaceId) : undefined
    if (!workspace && state.workspacePath && fs.existsSync(state.workspacePath)) {
      workspace = await workspaceRegistry.create(canonicalDir(state.workspacePath), state.workspaceName ?? `QQ ${state.chat.id}`)
    }
    if (!workspace) {
      const dir = canonicalDir(mkdirp(workspacePath(userDir(this.root, state.chat.id), this.config.defaultWorkspaceName)))
      workspace = await workspaceRegistry.create(dir, `QQ ${state.chat.id}`)
    }

    workspace = await this.normalizeWorkspace(workspaceRegistry, workspace)

    state.workspaceId = workspace.id
    state.workspacePath = workspace.path
    state.workspaceName = workspace.title
    this.persist(state)
    return workspace
  }

  /**
   * Re-register a workspace whose stored path is not canonical (its directory
   * became a symlink or junction after registration) and move its sessions to
   * the canonical record. Without this, `attachSession` throws
   * "its cwd ... cannot be validated" and the GUI loses the session grouping.
   * @param {any} registry
   * @param {any} workspace
   */
  async normalizeWorkspace(registry, workspace) {
    const canonical = canonicalDir(workspace.path)
    if (canonical === workspace.path) return workspace

    let target = registry.list().find((item) => item.path === canonical)
    if (!target) {
      try {
        target = await registry.create(canonical, workspace.title)
      } catch (error) {
        this.log('warn', `could not re-register workspace ${canonical}: ${error?.message ?? error}`)
        return workspace
      }
    }

    const candidates = new Set(workspace.sessionIds ?? [])
    for (const sessionId of await this.sessionIdsUnder(canonical)) candidates.add(sessionId)
    let moved = 0
    for (const sessionId of candidates) {
      try {
        await target.attachSession(sessionId)
        moved += 1
      } catch (error) {
        this.log('warn', `could not move session ${sessionId} to ${canonical}: ${error?.message ?? error}`)
      }
    }

    if (target.id !== workspace.id) {
      try {
        await registry.delete(workspace.id)
      } catch (error) {
        this.log('warn', `could not drop legacy workspace ${workspace.id}: ${error?.message ?? error}`)
      }
    }
    this.log('info', `workspace path canonicalized ${workspace.path} -> ${canonical} (moved ${moved} sessions)`)
    return target
  }

  /**
   * Session ids whose stored cwd resolves to `canonical`, live or only on disk.
   * @param {string} canonical
   * @returns {Promise<string[]>}
   */
  async sessionIdsUnder(canonical) {
    const ids = []
    const matches = (header) => Boolean(header?.id && header?.cwd && canonicalDir(header.cwd) === canonical)
    try {
      const live = this.ctx.get('sessions')
      for (const session of live?.list?.() ?? []) {
        if (matches(session?.header)) ids.push(session.header.id)
      }
    } catch {
      // live sessions are optional here
    }
    try {
      const persistence = this.ctx.get('sessionPersistence')
      for (const snapshot of (await persistence?.list?.()) ?? []) {
        if (matches(snapshot?.header) && !ids.includes(snapshot.header.id)) ids.push(snapshot.header.id)
      }
    } catch {
      // stored snapshots are optional too
    }
    return ids
  }

  async ensureSession(state) {
    if (state.handle) return state.handle
    if (state.opening) return state.opening
    state.opening = this.openSession(state).finally(() => {
      state.opening = undefined
    })
    return state.opening
  }

  async openSession(state) {
    const workspace = await this.ensureWorkspace(state)
    const { agents, approval } = this.services()

    if (state.sessionId) {
      const live = agents.get(state.sessionId)
      if (live) {
        state.handle = { agent: live }
        this.log('info', `session attached ${state.key} ${state.sessionId}`)
        return state.handle
      }
      try {
        const handle = await agents.resume({ resumeSessionId: state.sessionId, agentOptions: this.agentOptions() })
        await this.attach(workspace, state.sessionId)
        await this.ensurePreset(handle.agent)
        await this.applySessionExtensions(handle, state)
        this.track(state, state.sessionId)
        this.applySandboxMode(handle.agent.session, state.level ?? 'L1', state.capabilities ?? [], state)
        state.handle = handle
        this.log('info', `session resumed ${state.key} ${state.sessionId}`)
        return handle
      } catch (error) {
        this.log('warn', `resume failed for ${state.sessionId}: ${error?.message ?? error}; creating a new session`)
        state.sessionId = undefined
      }
    }
    return this.createSession(state, workspace)
  }

  async createSession(state, workspace) {
    const { agents, approval } = this.services()
    const sessionId = `sess-qq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const handle = await agents.create({
      sessionId,
      meta: {
        cwd: workspace.path,
        ...(this.config.agent.preset ? { agentPreset: this.config.agent.preset } : {}),
      },
      agentOptions: this.agentOptions(),
    })
    await this.attach(workspace, sessionId)
    await this.ensurePreset(handle.agent)
    await this.applySessionExtensions(handle, state)
    this.track(state, sessionId)
    this.applySandboxMode(handle.agent.session, state.level ?? 'L1', state.capabilities ?? [], state)

    state.sessionId = sessionId
    state.sessions[workspace.id] = sessionId
    state.handle = handle
    this.persist(state)
    this.log('info', `session ready ${state.key} ${sessionId} cwd=${workspace.path}`)
    return handle
  }

  async attach(workspace, sessionId) {
    try {
      await workspace.attachSession(sessionId)
    } catch (error) {
      this.log('warn', `attach failed for ${sessionId}: ${error?.message ?? error}`)
    }
  }

  track(state, sessionId, requester = state.chat.id) {
    if (!sessionId) return
    this.bindSession?.(sessionId, state.chat)
    this.approval?.track(sessionId, {
      chat: state.chat,
      level: state.level ?? 'L1',
      requester: String(requester),
    })
  }

  /**
   * Appoint the session's sandbox mode from the level mapping. The mode lives
   * in the session log (`sandbox/mode`), so replay keeps it across restarts.
   * @param {any} session
   * @param {string} level
   * @param {any} state
   */
  applySandboxMode(session, level, capabilities, state) {
    const configured = this.config.sandbox?.modeByLevel ?? {}
    let mode = configured[level] ?? 'read-only'
    if (level === 'L3') {
      mode = configured.L3 ?? 'danger-full-access'
    } else if (level !== 'L0' && (capabilities.includes('write') || capabilities.includes('exec'))) {
      mode = 'workspace-write'
    }
    if (state.sandboxMode === mode) return mode
    try {
      const policy = this.ctx.get('sandboxPolicy')
      const current = policy?.overrideOf?.(session)
      if (current !== mode) session.append('sandbox/mode', { mode })
      state.sandboxMode = mode
      this.log('info', `sandbox mode ${mode} for ${state.key}`)
    } catch (error) {
      this.log('warn', `sandbox mode was not applied: ${error?.message ?? error}`)
    }
    return mode
  }

  /**
   * Explicit switch used by the `/sandbox` command.
   * @param {{ type: string, id: string }} chat
   * @param {'read-only' | 'workspace-write' | 'danger-full-access'} mode
   */
  async setSandboxMode(chat, mode) {
    const state = this.stateFor(chat)
    const handle = await this.ensureSession(state)
    handle.agent.session.append('sandbox/mode', { mode })
    state.sandboxMode = mode
    this.log('info', `sandbox mode ${mode} switched for ${state.key}`)
    return mode
  }

  async listWorkspaces(chat) {
    const { workspaceRegistry } = this.services()
    const base = userDir(this.root, chat.id)
    return workspaceRegistry
      .list()
      .filter((workspace) => ownsDir(base, workspace.path))
      .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
  }

  async createWorkspace(chat, name, level = 'L1') {
    const clean = validateName(name)
    const existing = (await this.listWorkspaces(chat)).find((workspace) => uniquenessKey(workspace.title) === uniquenessKey(clean))
    if (existing) throw new Error(`工作区已存在：${existing.title}`)

    const state = this.stateFor(chat)
    state.level = level
    const maxWorkspaces = this.config.limits.maxWorkspaces?.[level] ?? 0
    if (maxWorkspaces > 0 && (await this.listWorkspaces(chat)).length >= maxWorkspaces) {
      throw new Error(`${level} 最多创建 ${maxWorkspaces} 个工作区`)
    }
    const dir = workspacePath(userDir(this.root, chat.id), clean)
    fs.mkdirSync(dir, { recursive: true })
    const { workspaceRegistry } = this.services()
    const workspace = await workspaceRegistry.create(dir, clean)

    state.workspaceId = workspace.id
    state.workspacePath = workspace.path
    state.workspaceName = workspace.title
    state.sessionId = undefined
    state.handle = undefined
    this.persist(state)
    await this.ensureSession(state)
    this.log('info', `workspace created ${state.key} ${workspace.path}`)
    return workspace
  }

  async useWorkspace(chat, token, level = 'L1') {
    const workspaces = await this.listWorkspaces(chat)
    const workspace = resolveByIndexOrName(workspaces, token)
    if (!workspace) throw new Error(`找不到工作区：${token}`)

    const state = this.stateFor(chat)
    state.level = level
    state.workspaceId = workspace.id
    state.workspacePath = workspace.path
    state.workspaceName = workspace.title
    state.sessionId = state.sessions?.[workspace.id]
    state.handle = undefined
    this.persist(state)
    await this.ensureSession(state)
    this.log('info', `workspace switched ${state.key} ${workspace.path}`)
    return workspace
  }

  async renameWorkspace(chat, name) {
    const clean = validateName(name)
    const state = this.stateFor(chat)
    const workspaces = await this.listWorkspaces(chat)
    const workspace = workspaces.find((item) => item.id === state.workspaceId)
    if (!workspace) throw new Error('当前没有工作区')
    await workspace.setTitle(clean)
    state.workspaceName = clean
    this.persist(state)
    return workspace
  }

  /**
   * Remove a workspace from the DSH registry. DSH never deletes the directory
   * or its sessions; they simply become ungrouped. The caller should tell the
   * user that files are kept.
   * @param {{ type: string, id: string }} chat
   * @param {string} token 1-based index or title
   * @param {string} level
   */
  async deleteWorkspace(chat, token, level = 'L1') {
    const workspaces = await this.listWorkspaces(chat)
    const workspace = resolveByIndexOrName(workspaces, token)
    if (!workspace) throw new Error(`找不到工作区：${token}`)

    const state = this.stateFor(chat)
    state.level = level
    await this.services().workspaceRegistry.delete(workspace.id)
    if (state.workspaceId === workspace.id) {
      state.workspaceId = undefined
      state.workspacePath = undefined
      state.workspaceName = undefined
      state.sessionId = undefined
      state.handle = undefined
      state.sessions = {}
    }
    this.persist(state)
    this.log('info', `workspace removed ${state.key} ${workspace.path}`)
    return workspace
  }

  async newSession(chat, level = 'L1', label) {
    const state = this.stateFor(chat)
    state.level = level
    await this.ensureWorkspace(state)
    state.sessionId = undefined
    state.handle = undefined
    this.persist(state)
    const handle = await this.ensureSession(state)
    if (label !== undefined) {
      this.setSessionLabel(state, label)
    }
    this.log('info', `new session ${state.key} ${state.sessionId}`)
    return handle
  }

  setSessionLabel(state, label) {
    const clean = normalizeLabel(label)
    if (!clean) throw new Error('会话名称不能为空')
    state.labels[state.sessionId] = clean
    this.persist(state)
    return clean
  }

  /**
   * Cache the DSH-generated title of the session so `/sessions` can show a
   * readable name when the user never renamed it.
   * @param {any} state
   * @param {any} session
   */
  rememberTitle(state, session) {
    const id = state?.sessionId ?? session?.header?.id
    if (!id) return
    const title = liveSessionTitle(session)
    if (title === '' || state.titles[id] === title) return
    state.titles[id] = title
    this.persist(state)
  }

  /**
   * Title stored in the session log, for sessions that are not live anymore.
   * Reads at most the first 200 events: `session/title` is written up front.
   * @param {any} state
   * @param {string} sessionId
   * @returns {Promise<string>}
   */
  async storedTitle(state, sessionId) {
    if (state.titles[sessionId]) return state.titles[sessionId]
    try {
      const persistence = this.ctx.get('sessionPersistence')
      const handle = await persistence?.open?.(sessionId, 'read')
      if (!handle) return ''
      try {
        const { events } = await handle.read(0, 200)
        const title = titleFromEvents(events ?? [])
        if (title !== '') {
          state.titles[sessionId] = title
          this.persist(state)
        }
        return title
      } finally {
        await handle.close?.()
      }
    } catch (error) {
      this.log('warn', `could not read the title of ${sessionId}: ${error?.message ?? error}`)
      return ''
    }
  }

  async renameSession(chat, label) {
    const state = this.stateFor(chat)
    await this.ensureSession(state)
    return this.setSessionLabel(state, label)
  }

  async listSessions(chat, level = 'L1') {
    const state = this.stateFor(chat)
    state.level = level
    const workspace = await this.ensureWorkspace(state)
    const archived = new Set(state.archived ?? [])
    const sessionIds = [...workspace.sessionIds].filter((id) => !archived.has(id))

    const titles = {}
    const live = state.handle?.agent?.session
    if (live && state.sessionId) {
      this.rememberTitle(state, live)
      const liveTitle = liveSessionTitle(live)
      if (liveTitle !== '') titles[state.sessionId] = liveTitle
    }
    for (const id of [...sessionIds, ...archived]) {
      if (titles[id] || state.labels[id]) continue
      const title = state.titles[id] ?? (await this.storedTitle(state, id))
      if (title !== '') titles[id] = title
    }

    return {
      workspace,
      activeSessionId: state.sessionId,
      sessionIds,
      archived: [...archived],
      labels: { ...state.labels },
      titles,
    }
  }

  /**
   * Resolve a session by 1-based index, label, or id prefix.
   * @param {{ type: string, id: string }} chat
   * @param {string} token
   * @param {{ includeArchived?: boolean }} [options]
   */
  async resolveSession(chat, token, { includeArchived = false } = {}) {
    const { sessionIds, archived, labels, titles } = await this.listSessions(chat)
    const pool = includeArchived ? [...sessionIds, ...archived] : sessionIds
    const index = Number(token)
    if (Number.isInteger(index) && index >= 1 && index <= pool.length) return pool[index - 1]
    const wanted = uniquenessKey(token)
    return pool.find((id) => labels[id] === token)
      ?? pool.find((id) => titles[id] && uniquenessKey(titles[id]) === wanted)
      ?? pool.find((id) => id.startsWith(String(token)))
  }

  async archiveSession(chat, token) {
    const state = this.stateFor(chat)
    if (state.pending > 0) throw new Error('当前还有回合在跑，结束后再归档')
    const { sessionIds, labels } = await this.listSessions(chat, state.level ?? 'L1')
    let sessionId
    if (token === undefined || token === '') sessionId = state.sessionId
    else {
      const index = Number(token)
      sessionId = Number.isInteger(index) && index >= 1 && index <= sessionIds.length
        ? sessionIds[index - 1]
        : sessionIds.find((id) => labels[id] === token) ?? sessionIds.find((id) => id.startsWith(String(token)))
    }
    if (!sessionId) throw new Error(`找不到可归档的会话：${token ?? '当前会话'}`)

    try {
      const registry = this.ctx.get('workspaceRegistry')
      await registry?.archiveSession?.(sessionId)
    } catch (error) {
      this.log('warn', `workspace archive refused for ${sessionId}: ${error?.message ?? error}`)
    }

    state.archived = [...new Set([...(state.archived ?? []), sessionId])]
    if (state.sessionId === sessionId) {
      state.sessionId = undefined
      state.handle = undefined
    }
    this.persist(state)
    this.log('info', `session archived ${state.key} ${sessionId}`)
    return { sessionId, label: state.labels[sessionId] }
  }

  async unarchiveSession(chat, token) {
    const state = this.stateFor(chat)
    const sessionId = await this.resolveSession(chat, token, { includeArchived: true })
    if (!sessionId) throw new Error(`找不到归档会话：${token}`)
    try {
      const registry = this.ctx.get('workspaceRegistry')
      await registry?.unarchiveSession?.(sessionId)
    } catch (error) {
      this.log('warn', `workspace unarchive refused for ${sessionId}: ${error?.message ?? error}`)
    }
    state.archived = (state.archived ?? []).filter((id) => id !== sessionId)
    this.persist(state)
    this.log('info', `session unarchived ${state.key} ${sessionId}`)
    return { sessionId, label: state.labels[sessionId] }
  }

  async useSession(chat, token, level = 'L1') {
    const state = this.stateFor(chat)
    state.level = level
    const { sessionIds, labels } = await this.listSessions(chat, level)
    const index = Number(token)
    let sessionId
    if (Number.isInteger(index) && index >= 1 && index <= sessionIds.length) {
      sessionId = sessionIds[index - 1]
    } else {
      sessionId = sessionIds.find((id) => labels[id] === token)
        ?? sessionIds.find((id) => id.startsWith(String(token)))
    }
    if (!sessionId) throw new Error(`找不到会话：${token}（切换工作区请用 /ws use <名称|序号>）`)

    state.sessionId = sessionId
    state.sessions[state.workspaceId] = sessionId
    state.handle = undefined
    this.persist(state)
    await this.ensureSession(state)
    return state.sessionId
  }

  async listAllWorkspaces() {
    const { workspaceRegistry } = this.services()
    return workspaceRegistry.list()
  }

  /** Directory of the chat's current workspace, provisioning it if needed. */
  async workspacePathFor(chat) {
    const state = this.stateFor(chat)
    const workspace = await this.ensureWorkspace(state)
    return workspace.path
  }

  /**
   * Find the QQ chat that owns a live session (used by question/answer and
   * other session-scoped callbacks).
   * @param {string} sessionId
   */
  chatForSession(sessionId) {
    if (this.resolveChat) return this.resolveChat(sessionId)
    for (const state of this.chats.values()) {
      if (state.sessionId === sessionId) return state.chat
    }
    return undefined
  }

  async cancelCurrent(chat) {
    const state = this.stateFor(chat)
    if (!state.handle) return false
    state.handle.agent.cancel({ kind: 'user' })
    return true
  }

  sessionSummary(chat) {
    const state = this.stateFor(chat)
    return {
      chat: state.chat,
      workspaceId: state.workspaceId,
      workspacePath: state.workspacePath,
      workspaceName: state.workspaceName,
      sessionId: state.sessionId,
      sessionShort: shortId(state.sessionId),
      sessionLabel: state.labels[state.sessionId],
      sandboxMode: state.sandboxMode,
      pending: state.pending,
    }
  }

  /**
   * @param {{ id: string, chat: { type: 'private' | 'group', id: string }, text: string }} message
   */
  async handle(message, { level = 'L1', capabilities = [], imageQuota } = {}) {
    const state = this.stateFor(message.chat)
    state.level = level
    state.capabilities = capabilities
    if (imageQuota !== undefined) state.imageQuota = imageQuota
    if (state.pending >= this.config.agent.maxQueue) {
      await this.reply(message.chat, '[qq-bridge] 当前还有消息在处理，请稍后再发。')
      return
    }

    state.pending += 1
    state.chain = state.chain
      .then(() => this.run(state, message))
      .catch((error) => {
        this.log('error', `turn failed for ${state.key}: ${error?.stack ?? error}`)
        return this.reply(message.chat, `[qq-bridge] 处理失败：${clip(error?.message ?? error)}`)
      })
      .finally(() => {
        state.pending -= 1
      })
    return state.chain
  }

  async run(state, message) {
    // A group shares one state, but each turn must reply to its own sender.
    // `state.chat` is otherwise the first chat object that created the state.
    if (message?.chat) state.chat = message.chat
    const handle = await this.ensureSession(state)
    const session = handle.agent.session
    await this.applySessionExtensions(handle, state)
    this.track(state, session?.header?.id, message.userId)
    this.applySandboxMode(session, state.level ?? 'L1', state.capabilities ?? [], state)
    await this.flushFollowUps(state, session)

    this.delivered.set(session, session.seq)

    handle.agent.followup({
      id: `qq-${state.chat.type}-${state.chat.id}-${message.id}`,
      role: 'user',
      content: [{ type: 'text', text: message.text }],
      source: { kind: 'user' },
    })

    let timedOut = false
    try {
      await this.withTimeout(handle.agent.whenIdle(), this.config.agent.turnTimeoutMs)
    } catch {
      timedOut = true
      try {
        handle.agent.cancel({ kind: 'user' })
      } catch {
        // the agent may have stopped already
      }
    }

    if (timedOut) {
      this.delivered.set(session, session.seq)
      await this.reply(state.chat, '[qq-bridge] 处理超时，已中断本次任务。')
      return
    }

    await this.deliver(state, session, { derivedFallback: true })
    this.rememberTitle(state, session)
    this.watchFollowUps(state, session)
  }

  /**
   * Send what the agent produced since the last delivered sequence: media
   * forwarded by the turnEnd behavior, then the reply text.
   * @param {any} state
   * @param {any} session
   * @param {{ quiet?: boolean, derivedFallback?: boolean }} [options]
   * @returns {Promise<string>} the text that was sent, '' when nothing was
   */
  async deliver(state, session, { quiet = false, derivedFallback = false } = {}) {
    const fromSeq = this.delivered.get(session) ?? 0
    if (!(session.seq > fromSeq)) return ''
    this.delivered.set(session, session.seq)

    const error = turnError(session, fromSeq)
    if (error) {
      if (process.env.DSH_QQ_BRIDGE_DEBUG === '1') {
        this.log('debug', `derived=${JSON.stringify(derivedShape(session))}`)
      }
      await this.reply(state.chat, `[qq-bridge] 处理失败：${clip(error)}`)
      return ''
    }

    await this.behavior.turnEnd?.({
      sendImage: this.sendImage,
      sendText: this.send,
      chat: state.chat,
      session,
      fromSeq,
      state,
      level: state.level ?? 'L1',
      log: this.log,
    })

    const reply = replyTextSince(session, fromSeq) || (derivedFallback ? extractReplyText(session.deriveMessages()) : '')
    if (reply === '') {
      if (!quiet) await this.reply(state.chat, '[qq-bridge] 模型没有返回文本。')
      return ''
    }
    for (const chunk of splitText(reply, this.config.limits.maxChars)) {
      await this.reply(state.chat, chunk)
    }
    return reply
  }

  /**
   * A QQ turn can schedule later work (subagent completion, background job,
   * question answer). The agent then runs another turn on its own, which never
   * comes back through `handle()`. Watch the session for quiet turn boundaries
   * and deliver those turns too, otherwise their text and images are lost.
   * @param {any} state
   * @param {any} session
   */
  watchFollowUps(state, session) {
    const options = this.config.agent?.followUp
    this.stopFollowUps(state)
    if (!options?.enabled) return
    const token = Symbol('qq-follow-up')
    state.followUp = token
    let lastActivity = Date.now()
    const stop = () => {
      if (state.followUp === token) this.stopFollowUps(state)
    }
    const timer = setInterval(() => {
      if (state.followUp !== token) return
      if (Date.now() - lastActivity > options.idleMs) return stop()
      let pending
      try {
        pending = session.snapshotEvents(this.delivered.get(session) ?? 0)
      } catch (error) {
        this.log('warn', `follow-up watch stopped: ${error?.message ?? error}`)
        return stop()
      }
      if (pending.length === 0) return
      lastActivity = Date.now()
      if (pending[pending.length - 1]?.type !== 'turn/end') return
      state.chain = state.chain
        .then(() => this.deliver(state, session, { quiet: true }))
        .catch((error) => this.log('warn', `follow-up delivery failed: ${error?.stack ?? error}`))
    }, options.pollMs)
    timer.unref?.()
    state.followUpTimer = timer
  }

  stopFollowUps(state) {
    if (state.followUpTimer) clearInterval(state.followUpTimer)
    state.followUpTimer = undefined
    state.followUp = undefined
  }

  /**
   * Deliver a finished follow-up turn that is still pending when the next QQ
   * message arrives, so the new turn never swallows it.
   * @param {any} state
   * @param {any} session
   */
  async flushFollowUps(state, session) {
    this.stopFollowUps(state)
    // Nothing was delivered for this session yet (fresh resume): the events on
    // disk are history, not a pending follow-up, so never replay them.
    if (!this.delivered.has(session)) return
    const from = this.delivered.get(session)
    if (!(session.seq > from)) return
    let pending
    try {
      pending = session.snapshotEvents(from)
    } catch {
      return
    }
    if (pending.length === 0) return
    if (pending[pending.length - 1]?.type !== 'turn/end') return
    await this.deliver(state, session, { quiet: true })
  }

  withTimeout(promise, timeoutMs) {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('turn timed out')), timeoutMs)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  }

  async reply(chat, text) {
    try {
      await this.send(chat, text)
    } catch (error) {
      this.log('error', `reply failed: ${error?.message ?? error}`)
    }
  }

  status() {
    return {
      chats: this.chats.size,
      pending: [...this.chats.values()].reduce((sum, state) => sum + state.pending, 0),
    }
  }
}

/**
 * Resolve a workspace by 1-based index, exact title, or id prefix.
 * @param {Array<{ id: string, title: string }>} workspaces
 * @param {string} token
 */
function resolveByIndexOrName(workspaces, token) {
  const index = Number(token)
  if (Number.isInteger(index) && index >= 1 && index <= workspaces.length) return workspaces[index - 1]
  return workspaces.find((workspace) => workspace.title === token)
    ?? workspaces.find((workspace) => workspace.id.startsWith(String(token)))
}
