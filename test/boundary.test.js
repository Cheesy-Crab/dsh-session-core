import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'src')

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(file) : entry.name.endsWith('.js') ? [file] : []
  })
}

test('session core does not import QQ or capability plugins', () => {
  const offenders = []
  for (const file of walk(src)) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1]
      if (specifier.startsWith('node:') || specifier.startsWith('./')) continue
      offenders.push(`${path.relative(root, file)} -> ${specifier}`)
    }
  }
  assert.deepEqual(offenders, [])
})
