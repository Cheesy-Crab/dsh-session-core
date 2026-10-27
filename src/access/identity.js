const NAMESPACED = /^(qq|qq-group|web|telegram|cli):/

export function qqPrincipal(id) {
  return `qq:${String(id ?? '').trim()}`
}

export function qqGroupPrincipal(id) {
  return `qq-group:${String(id ?? '').trim()}`
}

export function webPrincipal(id) {
  return `web:${String(id ?? '').trim()}`
}

/**
 * Normalize legacy keys into namespaced principals:
 *   123456          -> qq:123456
 *   group:123456    -> qq-group:123456
 *   qq:123 / web:x  -> unchanged
 * Non-numeric opaque ids (tests, web users) pass through.
 */
export function normalizePrincipal(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return raw
  if (NAMESPACED.test(raw)) return raw
  if (raw.startsWith('group:')) return qqGroupPrincipal(raw.slice('group:'.length))
  if (/^\d{5,12}$/.test(raw)) return qqPrincipal(raw)
  return raw
}
