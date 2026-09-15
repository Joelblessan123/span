/**
 * Medium blog posts for the public site.
 *
 * Medium’s RSS feed only returns the ~10 newest stories, so older live posts
 * must be kept in `src/data/mediumBlogArchive.json` (same item shape as rss2json).
 * When new posts push older ones out of RSS, add them to the archive or they
 * disappear from spanationwide.org/blog.
 */
import archiveItems from '../data/mediumBlogArchive.json'

const MEDIUM_RSS =
  'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fmedium.com%2Ffeed%2F%40spanationwide'

function postKey(item) {
  const guid = String(item?.guid || '')
    .trim()
    .replace(/\?.*$/, '')
  if (guid) {
    const hex = guid.match(/\/p\/([a-f0-9]+)/i)?.[1]
    if (hex) return hex.toLowerCase()
    return guid.toLowerCase()
  }
  const link = String(item?.link || '')
    .trim()
    .replace(/\?.*$/, '')
  const fromLink = link.match(/-([a-f0-9]{8,})$/i)?.[1]
  if (fromLink) return fromLink.toLowerCase()
  return link.toLowerCase()
}

function parsePubTime(pubDate) {
  if (!pubDate) return 0
  const s = String(pubDate).trim()
  const asIso = s.includes('T') ? s : s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')
  const t = Date.parse(asIso)
  return Number.isFinite(t) ? t : 0
}

/**
 * @returns {Promise<{ ok: true, items: object[] } | { ok: false, error: string, items: object[] }>}
 */
export async function fetchMediumBlogItems() {
  /** @type {object[]} */
  let live = []
  let error = ''
  try {
    const res = await fetch(MEDIUM_RSS)
    if (!res.ok) throw new Error('Failed to fetch blog posts')
    const data = await res.json()
    live = Array.isArray(data.items) ? data.items : []
  } catch (e) {
    error = e?.message || 'Failed to fetch blog posts'
  }

  const byKey = new Map()
  // Archive first, then live overwrites so RSS stays canonical for recent posts.
  for (const item of archiveItems || []) {
    const k = postKey(item)
    if (k) byKey.set(k, item)
  }
  for (const item of live) {
    const k = postKey(item)
    if (k) byKey.set(k, item)
  }

  const items = [...byKey.values()].sort((a, b) => parsePubTime(b.pubDate) - parsePubTime(a.pubDate))

  if (!items.length && error) {
    return { ok: false, error, items: [] }
  }
  return { ok: true, items, error: error || undefined }
}

/**
 * @param {object[]} items
 * @param {string} postId
 */
export function findMediumBlogItem(items, postId) {
  const id = String(postId || '').trim()
  if (!id || !items?.length) return null
  const idKey = postKey({ guid: id, link: id })
  return (
    items.find((item) => {
      const itemId = item.guid || item.link
      if (itemId === id) return true
      if (itemId && (String(itemId).includes(id) || id.includes(String(itemId)))) return true
      return postKey(item) === idKey
    }) || null
  )
}
