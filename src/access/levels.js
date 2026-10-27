export const LEVELS = Object.freeze(['L0', 'L1', 'L2', 'L3'])

/**
 * @param {string} level
 * @returns {number} 0 for L0/unknown
 */
export function rank(level) {
  const index = LEVELS.indexOf(String(level).toUpperCase())
  return index < 0 ? 0 : index
}

/**
 * @param {string} level
 * @param {string} required
 */
export function atLeast(level, required) {
  return rank(level) >= rank(required)
}

/**
 * @param {unknown} value
 * @returns {'L0' | 'L1' | 'L2' | 'L3'}
 */
export function normalizeLevel(value) {
  const up = String(value ?? '').toUpperCase()
  return LEVELS.includes(up) ? up : 'L0'
}
