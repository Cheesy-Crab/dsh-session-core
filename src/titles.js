/**
 * Session titles live in the session log as `session/title` events; the header
 * carries no title field. QQ's `/sessions` shows the newest one when the user
 * never renamed the session, instead of a meaningless id hash.
 */

/**
 * Newest usable title among `events`.
 * @param {Array<{ type?: string, data?: any }>} [events]
 * @returns {string}
 */
export function titleFromEvents(events) {
  let title = ''
  for (const event of events ?? []) {
    if (event?.type !== 'session/title') continue
    const value = event.data?.title
    if (typeof value === 'string' && value.trim() !== '') title = value.trim()
  }
  return title
}

/**
 * Title of a live session, scanning backwards from the head first because
 * `session/title` is written near the start and the log can be long.
 * @param {any} session
 * @returns {string}
 */
export function liveSessionTitle(session) {
  if (!session) return ''
  const fromEventAt = () => {
    if (typeof session.eventAt !== 'function' || typeof session.seq !== 'number') return ''
    const head = session.seq
    const floor = Math.max(0, head - 500)
    for (let seq = head - 1; seq >= floor; seq -= 1) {
      const event = session.eventAt(seq)
      if (event?.type !== 'session/title') continue
      const value = event.data?.title
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
    return ''
  }
  try {
    const found = fromEventAt()
    if (found !== '') return found
  } catch {
    // fall through to a full snapshot read
  }
  try {
    return titleFromEvents(session.snapshotEvents?.(0) ?? [])
  } catch {
    return ''
  }
}
