/**
 * Last assistant text in a derived session history. Tool-only turns without a
 * final text produce an empty string.
 * @param {Array<{ role?: string, content?: Array<{ type?: string, text?: string }> }>} messages
 * @returns {string}
 */
export function extractReplyText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant') continue
    const parts = Array.isArray(message.content) ? message.content : []
    const text = parts
      .filter((part) => part?.type === 'text')
      .map((part) => part.text ?? '')
      .join('')
      .trim()
    if (text !== '') return text
  }
  return ''
}

/**
 * Last assistant text among the events recorded after `fromSeq`. Delivering per
 * event range keeps an autonomous follow-up turn from re-sending an earlier
 * reply, which `extractReplyText` (whole history) cannot tell apart.
 * @param {{ snapshotEvents?: (from: number) => Array<any> }} session
 * @param {number} fromSeq
 * @returns {string}
 */
export function replyTextSince(session, fromSeq) {
  try {
    const events = session.snapshotEvents(fromSeq)
    let text = ''
    for (const event of events) {
      if (event?.type !== 'assistant/message') continue
      const parts = event.data?.message?.content
      if (!Array.isArray(parts)) continue
      const joined = parts
        .filter((part) => part?.type === 'text')
        .map((part) => part.text ?? '')
        .join('')
        .trim()
      if (joined !== '') text = joined
    }
    return text
  } catch {
    return ''
  }
}

/**
 * Split one long reply into QQ-sized chunks. Prefers paragraph breaks, then
 * line breaks, then a hard cut; never splits a surrogate pair.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]}
 */
export function splitText(text, maxChars) {
  const cleaned = String(text).replace(/\r\n/g, '\n').trim()
  if (cleaned === '') return []
  if (!Number.isInteger(maxChars) || maxChars <= 0) return [cleaned]
  if (cleaned.length <= maxChars) return [cleaned]

  const chunks = []
  let rest = cleaned
  while (rest.length > maxChars) {
    const floor = Math.floor(maxChars * 0.5)
    let cut = rest.lastIndexOf('\n\n', maxChars)
    if (cut < floor) cut = rest.lastIndexOf('\n', maxChars)
    if (cut < floor) cut = maxChars
    if (cut > 0 && /[\uD800-\uDBFF]/.test(rest[cut - 1])) cut -= 1
    const head = rest.slice(0, cut).trimEnd()
    if (head !== '') chunks.push(head)
    rest = rest.slice(cut).trimStart()
  }
  if (rest !== '') chunks.push(rest)
  return chunks
}

/**
 * Pull the failure text out of the last errored turn after `fromSeq`.
 * @param {{ snapshotEvents?: (from: number) => Array<any> }} session
 * @param {number} fromSeq
 * @returns {string | undefined}
 */
export function turnError(session, fromSeq) {
  try {
    const events = session.snapshotEvents(fromSeq)
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type !== 'turn/end') continue
      if (event.data?.reason?.kind !== 'error') return undefined
      return String(event.data.reason.error?.message ?? 'unknown error')
    }
  } catch {
    return undefined
  }
  return undefined
}
