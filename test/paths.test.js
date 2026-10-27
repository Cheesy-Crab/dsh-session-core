import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  assertInside,
  expandVars,
  groupDir,
  isInside,
  ownerHash,
  ownsDir,
  realpathOrSelf,
  resolveWorkspacesRoot,
  slugify,
  uniquenessKey,
  userDir,
  validateName,
  workspacePath,
} from '../src/paths.js'

const tmpHome = path.join(os.tmpdir(), 'dsh-qq-test-home')

test('default root is E:\\QQdsh on Windows', () => {
  assert.equal(resolveWorkspacesRoot(undefined, { DSH_HOME: tmpHome }, 'win32'), 'E:\\QQdsh')
})

test('default root follows DSH_HOME on other platforms', () => {
  assert.equal(resolveWorkspacesRoot(undefined, { DSH_HOME: '/home/dsh' }, 'linux'), '/home/dsh/qq-workspaces')
})

test('root expands ${DSH_HOME}', () => {
  const root = resolveWorkspacesRoot('${DSH_HOME}/custom', { DSH_HOME: tmpHome })
  assert.equal(root, path.resolve(tmpHome, 'custom'))
})

test('root keeps an explicit absolute path', () => {
  const explicit = path.join(tmpHome, 'explicit')
  assert.equal(resolveWorkspacesRoot(explicit, { DSH_HOME: tmpHome }), path.resolve(explicit))
})

test('expandVars leaves unknown names empty', () => {
  assert.equal(expandVars('${KNOWN}/x/${UNKNOWN}', { KNOWN: 'k' }), 'k/x/')
})

test('owner hash is stable, short, and distinct', () => {
  assert.match(ownerHash('u1'), /^[0-9a-f]{8}$/)
  assert.equal(ownerHash('u1'), ownerHash('u1'))
  assert.notEqual(ownerHash('u1'), ownerHash('u2'))
})

test('owner directories are short and prefixed', () => {
  assert.match(path.basename(userDir('/root', 'u1')), /^u-[0-9a-f]{8}$/)
  assert.match(path.basename(groupDir('/root', 'g1')), /^g-[0-9a-f]{8}$/)
})

test('uniqueness ignores case and width', () => {
  assert.equal(uniquenessKey('A'), uniquenessKey('a'))
  assert.equal(uniquenessKey('Ａ'), uniquenessKey('A'))
  assert.notEqual(uniquenessKey('a'), uniquenessKey('b'))
})

test('names accept Chinese and are trimmed', () => {
  assert.equal(validateName('  我的项目  '), '我的项目')
  assert.equal(validateName('a '), 'a')
})

test('names reject Windows-hostile input', () => {
  for (const bad of ['', '   ', 'a/b', 'a\\b', 'a:b', 'con', 'CON.txt', 'a.', '..', '.', 'x'.repeat(65)]) {
    assert.throws(() => validateName(bad), /invalid workspace name/, `expected ${JSON.stringify(bad)} to fail`)
  }
})

test('slug is ASCII and case-insensitive names share a directory', () => {
  assert.match(slugify('我的 项目'), /^[a-z0-9-]+$/)
  assert.equal(slugify('我的 项目'), 'ws')
  assert.equal(slugify('My Project'), 'my-project')
  assert.equal(workspacePath('/root', 'Project'), workspacePath('/root', 'project'))
})

test('workspace path stays under its owner directory', () => {
  const base = path.join('/root', 'u-12345678')
  const dir = workspacePath(base, '我的项目')
  assert.equal(path.dirname(dir), base)
  assert.ok(path.basename(dir).endsWith('-') === false)
  assert.ok(dir.length < 200)
})

test('isInside distinguishes siblings that share a prefix', () => {
  const root = path.join(os.tmpdir(), 'ws')
  assert.equal(isInside(root, path.join(root, 'a')), true)
  assert.equal(isInside(root, root), true)
  assert.equal(isInside(root, path.join(os.tmpdir(), 'wsx')), false)
  assert.equal(isInside(root, path.join(root, '..', 'evil')), false)
})

test('assertInside rejects escapes with a typed error', () => {
  const root = path.join(os.tmpdir(), 'ws')
  const outside = path.join(os.tmpdir(), 'wsx')
  assert.throws(() => assertInside(root, outside), (error) => error.code === 'PATH_ESCAPE')
  assert.equal(assertInside(root, path.join(root, 'a')), path.resolve(root, 'a'))
})

test('realpathOrSelf tolerates missing paths', () => {
  const missing = path.join(os.tmpdir(), 'definitely-missing-' + Date.now())
  assert.equal(realpathOrSelf(missing), missing)
})

test('ownsDir follows a junction inside the owner directory', () => {
  const stamp = `${Date.now()}-${process.pid}`
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `qq-base-${stamp}-`))
  const target = fs.mkdtempSync(path.join(os.tmpdir(), `qq-target-${stamp}-`))
  const link = path.join(base, 'linked-workspace')
  try {
    fs.symlinkSync(target, link, 'junction')
    const canonical = realpathOrSelf(target)
    assert.equal(ownsDir(base, canonical), true)
    assert.equal(ownsDir(base, path.join(base, 'inside')), true)
    assert.equal(ownsDir(base, fs.mkdtempSync(path.join(os.tmpdir(), `qq-other-${stamp}-`))), false)
  } finally {
    try {
      fs.rmdirSync(link)
    } catch {
      fs.rmSync(link, { recursive: true, force: true })
    }
    fs.rmSync(base, { recursive: true, force: true })
    fs.rmSync(target, { recursive: true, force: true })
  }
})
