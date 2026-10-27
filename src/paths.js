import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Characters Windows forbids in a file name; the strictest common denominator. */
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/
/** Windows device names are reserved even with an extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const MAX_SEGMENT = 64
const SLUG_MAX = 40

/**
 * Resolve the DSH home directory the same way the host does.
 * @param {Record<string, string | undefined>} [env]
 * @param {NodeJS.Platform} [platform]
 * @returns {string} absolute DSH home
 */
export function defaultDshHome(env = process.env, platform = process.platform) {
  const impl = platform === 'win32' ? path.win32 : path.posix
  return env.DSH_HOME ? impl.resolve(env.DSH_HOME) : impl.join(os.homedir(), '.dsh')
}

/**
 * Expand `${NAME}` placeholders from a lookup table.
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function expandVars(template, vars) {
  return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => vars[key] ?? '')
}

/**
 * Default workspace root per platform. Windows keeps QQ workspaces on the
 * dedicated `E:\QQdsh` tree; other platforms stay next to DSH state so a
 * server deployment needs no path configuration.
 * @param {Record<string, string | undefined>} [env]
 * @param {NodeJS.Platform} [platform]
 * @returns {string} a template that resolveWorkspacesRoot expands
 */
export function defaultWorkspacesRoot(env = process.env, platform = process.platform) {
  return platform === 'win32' ? 'E:\\QQdsh' : '${DSH_HOME}/qq-workspaces'
}

/**
 * Absolute workspace root. Empty config means the platform default.
 * @param {string | undefined} raw configured value, `${DSH_HOME}` allowed
 * @param {Record<string, string | undefined>} [env]
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function resolveWorkspacesRoot(raw, env = process.env, platform = process.platform) {
  const dshHome = defaultDshHome(env, platform)
  const vars = {
    DSH_HOME: dshHome,
    HOME: os.homedir(),
    USERPROFILE: env.USERPROFILE ?? os.homedir(),
  }
  const value = (raw ?? '').trim()
  const impl = platform === 'win32' ? path.win32 : path.posix
  return impl.resolve(expandVars(value === '' ? defaultWorkspacesRoot(env, platform) : value, vars))
}

/**
 * Stable short hash used in directory names instead of raw QQ ids.
 * @param {string} value
 * @returns {string} 8 hex chars
 */
export function ownerHash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 8)
}

/**
 * Directory holding one QQ user's personal workspaces.
 * @param {string} root
 * @param {string} openid
 * @returns {string}
 */
export function userDir(root, openid) {
  return path.join(root, `u-${ownerHash(openid)}`)
}

/**
 * Directory holding one QQ group's shared workspace.
 * @param {string} root
 * @param {string} groupId
 * @returns {string}
 */
export function groupDir(root, groupId) {
  return path.join(root, `g-${ownerHash(groupId)}`)
}

/**
 * Case/width-insensitive identity of a display name. Windows compares names
 * case-insensitively while Linux does not, so uniqueness is decided on this key
 * to keep both platforms and later migrations consistent.
 * @param {string} name
 * @returns {string}
 */
export function uniquenessKey(name) {
  return String(name).normalize('NFKC').toLowerCase()
}

/**
 * Validate a user-visible workspace name against the strictest (Windows) rules.
 * @param {string} name
 * @returns {string} trimmed name
 * @throws {Error} with `.code = 'INVALID_WORKSPACE_NAME'`
 */
export function validateName(name) {
  const fail = (reason) => {
    const error = new Error(`invalid workspace name ${JSON.stringify(name)}: ${reason}`)
    error.code = 'INVALID_WORKSPACE_NAME'
    throw error
  }
  if (typeof name !== 'string') fail('not a string')
  const value = name.trim()
  if (value === '') fail('empty')
  if (Buffer.byteLength(value, 'utf8') > MAX_SEGMENT * 4) fail('too long')
  if (value.length > MAX_SEGMENT) fail(`longer than ${MAX_SEGMENT} characters`)
  if (value === '.' || value === '..') fail('dot path')
  if (FORBIDDEN.test(value)) fail('contains a forbidden character')
  if (RESERVED.test(value)) fail('is a reserved device name')
  if (/[. ]$/.test(value)) fail('ends with a dot or space')
  return value
}

/**
 * ASCII-safe path segment for a display name, with a hash suffix that keeps
 * distinct names distinct after slugging.
 * @param {string} name
 * @returns {string}
 */
export function slugify(name) {
  const key = uniquenessKey(validateName(name))
  const slug = key
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
  return slug === '' ? 'ws' : slug
}

/**
 * Absolute directory for one workspace. The hash suffix is derived from the
 * uniqueness key, so `A` and `a` (or full-width `Ａ`) still map to one name.
 * @param {string} baseDir
 * @param {string} name
 * @returns {string}
 */
export function workspacePath(baseDir, name) {
  const key = uniquenessKey(validateName(name))
  return path.join(baseDir, `${slugify(name)}-${ownerHash(key).slice(0, 6)}`)
}

/**
 * Real path when it exists, otherwise the input unchanged.
 * @param {string} target
 * @returns {string}
 */
export function realpathOrSelf(target) {
  try {
    return fs.realpathSync.native(target)
  } catch {
    return target
  }
}

/**
 * Whether `target` is `root` itself or strictly inside it.
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
export function isInside(root, target) {
  const rel = path.relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

/**
 * Whether a directory belongs to `base`: either it sits inside it, or it is the
 * resolved target of an entry inside it. DSH stores workspace paths canonical
 * (links resolved), so a workspace reached through a junction such as
 * `<base>\工作区对接QQ -> E:\dsh\工作区对接QQ` would otherwise stop belonging to
 * the QQ user who owns that junction.
 * @param {string} base
 * @param {string} target
 * @returns {boolean}
 */
export function ownsDir(base, target) {
  if (isInside(base, target)) return true
  const realTarget = realpathOrSelf(target)
  if (isInside(base, realTarget)) return true
  try {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (realpathOrSelf(path.join(base, entry.name)) === realTarget) return true
    }
  } catch {
    return false
  }
  return false
}

/**
 * Enforce that a path stays inside the workspace root, after resolving links.
 * @param {string} root
 * @param {string} target
 * @returns {string} the resolved target
 * @throws {Error} with `.code = 'PATH_ESCAPE'`
 */
export function assertInside(root, target) {
  const realRoot = realpathOrSelf(path.resolve(root))
  const realTarget = realpathOrSelf(path.resolve(target))
  if (!isInside(realRoot, realTarget)) {
    const error = new Error(`path escapes workspace root: ${realTarget} not under ${realRoot}`)
    error.code = 'PATH_ESCAPE'
    throw error
  }
  return realTarget
}
