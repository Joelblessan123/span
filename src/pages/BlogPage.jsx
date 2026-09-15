import React, { useEffect, useMemo, useState } from 'react'
import Pagination from '../components/Pagination'
import BlogCard from '../components/BlogCard'
import { fetchPublicDirectoryMembers } from '../lib/publicData'
import { memberNameLookupKeys, memberSiteDisplayName } from '../lib/memberDisplayName'
import { fetchMediumBlogItems } from '../lib/mediumBlog'
import { setPageSeo } from '../lib/documentSeo'
import '../pages/BlogPage.css'

const ITEMS_PER_PAGE = 6
const FALLBACK_IMAGE = 'https://via.placeholder.com/600x338?text=No+Image'
const MEMBER_IMAGE_BASE_URL = 'https://qujzohvrbfsouakzocps.supabase.co/storage/v1/object/public/members-images'
const DEFAULT_AUTHOR = {
  name: 'SPAN',
  link: '/index.html',
  avatar: '/images/index/logo-icon-light.svg'
}

const decodeHtmlEntities = (str = '') => {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "'")
    .replace(/&lsquo;/gi, "'")
    .replace(/&ldquo;/gi, '"')
    .replace(/&rdquo;/gi, '"')
    .replace(/&ndash;/gi, '-')
    .replace(/&mdash;/gi, '-')
}

const normalizeName = (name = '') =>
  decodeHtmlEntities(name)
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const getCandidateNames = (rawName = '') => {
  const cleaned = decodeHtmlEntities(rawName)
    .replace(/\(.*?\)/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return []
  const words = cleaned.split(' ').filter(Boolean)
  const candidates = new Set()
  candidates.add(cleaned)
  if (words.length >= 2) {
    candidates.add(`${words[0]} ${words[words.length - 1]}`)
  }
  if (words.length >= 1) {
    candidates.add(words[0])
  }
  return Array.from(candidates)
}

const buildMemberLookup = (members = []) => {
  return members.reduce((map, member) => {
    for (const name of memberNameLookupKeys(member)) {
      const normalized = normalizeName(name)
      if (normalized) {
        map.set(normalized, member)
      }
    }
    return map
  }, new Map())
}

const extractAuthorName = (item) => {
  const content = item.content || ''
  const match = content.match(/written\s+by\s*([^<\n\r]+)/i)
  if (match && match[1]) {
    return decodeHtmlEntities(
      match[1].replace(/[-–—].*$/, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    )
  }
  if (item.author) {
    return decodeHtmlEntities(item.author).replace(/\u00a0/g, ' ').trim()
  }
  return ''
}

const resolveMemberAvatar = (image) => {
  if (!image) return DEFAULT_AUTHOR.avatar
  if (/^https?:\/\//i.test(image)) return image
  return `${MEMBER_IMAGE_BASE_URL}/${image}`
}

const resolveAuthor = (item, memberLookup) => {
  const authorName = extractAuthorName(item)
  if (!authorName) {
    return { ...DEFAULT_AUTHOR }
  }

  const segments = authorName.split(/(?:,|&| and )/i).map((segment) => segment.trim()).filter(Boolean)
  // Prefer a person-looking first segment ("Noah Love") over org RSS author.
  const displayFallback = segments.find((s) => !/^students for patient advocacy/i.test(s)) || segments[0] || authorName

  if (memberLookup && memberLookup.size > 0) {
    for (const segment of segments) {
      const candidates = getCandidateNames(segment)
      for (const candidate of candidates) {
        const normalized = normalizeName(candidate)
        if (!normalized) continue

        const member = memberLookup.get(normalized)
        if (member) {
          const displayName = memberSiteDisplayName(member) || displayFallback

          const avatar = resolveMemberAvatar(member.image)
          return {
            name: displayName,
            link: `/directory.html?search=${encodeURIComponent(displayName)}`,
            avatar
          }
        }
      }
    }
  }

  // Keep byline name even when the writer is not (yet) in the public directory,
  // so author filters and cards don't collapse everyone to "SPAN".
  if (displayFallback && !/^students for patient advocacy/i.test(displayFallback)) {
    return {
      name: displayFallback,
      link: `/directory.html?search=${encodeURIComponent(displayFallback)}`,
      avatar: DEFAULT_AUTHOR.avatar
    }
  }

  return { ...DEFAULT_AUTHOR }
}

function pubDateParts(pubDate) {
  const estDate = new Date(`${String(pubDate || '').replace(' ', 'T')}Z`)
  if (Number.isNaN(estDate.getTime())) {
    return { estDate: null, formattedDate: '', year: null, month: null }
  }
  const formattedDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(estDate)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'numeric'
  }).formatToParts(estDate)
  const year = Number(parts.find((p) => p.type === 'year')?.value) || null
  const month = Number(parts.find((p) => p.type === 'month')?.value) || null
  return { estDate, formattedDate, year, month }
}

const MONTH_OPTIONS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
]

function normalizePost(item, memberLookup) {
  const descriptionMatch = item.description?.match(/<img[^>]+src="([^"]+)"/)
  const fromDescription = descriptionMatch?.[1] || ''
  const fromThumbnail = item.thumbnail && String(item.thumbnail).trim()
  // Prefer a real hero image over tiny Medium byline/avatars.
  const candidates = [fromThumbnail, fromDescription].filter(Boolean)
  const image =
    candidates.find((src) => !/resize:fill:(?:32|48|64|96):/.test(src)) ||
    candidates[0] ||
    FALLBACK_IMAGE

  const { formattedDate, year, month } = pubDateParts(item.pubDate)

  const cleanContent = item.content
    ?.replace(/<figcaption>.*?<\/figcaption>/gs, '')
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim() || ''

  const excerpt = cleanContent.length > 150 ? `${cleanContent.slice(0, 150)}…` : cleanContent

  const author = resolveAuthor(item, memberLookup)

  // Generate a URL-friendly ID from the post
  const postId = item.guid || item.link

  return {
    id: postId,
    title: item.title,
    link: item.link, // Keep original Medium link
    internalLink: `/blog-post.html?id=${encodeURIComponent(postId)}`, // Internal link
    image,
    formattedDate,
    pubYear: year,
    pubMonth: month,
    author,
    excerpt
  }
}

function BlogPage() {
  const [rawPosts, setRawPosts] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [authorFilter, setAuthorFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    setPageSeo({
      title: 'Blog | SPAN - Students for Patient Advocacy Nationwide',
      description:
        'SPAN blog: student-written insights on healthcare policy, advocacy, and patient-centered reform. Mirrored from our Medium publication onto spanationwide.org.',
      canonicalPath: '/blog.html',
      image: '/images/index/preview.jpg',
      type: 'website',
    })
  }, [])

  useEffect(() => {
    let isMounted = true

    async function fetchData() {
      try {
        setLoading(true)
        const feed = await fetchMediumBlogItems()
        if (!feed.ok && !feed.items.length) throw new Error(feed.error || 'Failed to fetch blog posts')
        const items = feed.items || []

        let membersData = []
        try {
          membersData = await fetchPublicDirectoryMembers({ requireRegistration: false })
        } catch (memberFetchError) {
          console.warn('Failed to fetch members for blog authors:', memberFetchError)
        }

        if (!isMounted) return
        setRawPosts(items)
        setMembers(membersData)
        setError(null)
        setCurrentPage(1)
      } catch (err) {
        if (!isMounted) return
        console.error('Failed to fetch RSS feed:', err)
        setError('Blog posts coming soon!')
        setRawPosts([])
        setMembers([])
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchData()

    return () => {
      isMounted = false
    }
  }, [])

  const memberLookup = useMemo(() => buildMemberLookup(members), [members])

  const normalizedPosts = useMemo(
    () => rawPosts.map((item) => normalizePost(item, memberLookup)),
    [rawPosts, memberLookup]
  )

  const authorOptions = useMemo(() => {
    const names = new Set()
    for (const post of normalizedPosts) {
      const name = post.author?.name?.trim()
      if (name) names.add(name)
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [normalizedPosts])

  const yearOptions = useMemo(() => {
    const years = new Set()
    for (const post of normalizedPosts) {
      if (post.pubYear) years.add(post.pubYear)
    }
    return [...years].sort((a, b) => b - a)
  }, [normalizedPosts])

  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return normalizedPosts.filter((post) => {
      if (authorFilter && post.author?.name !== authorFilter) return false
      if (yearFilter && String(post.pubYear) !== yearFilter) return false
      if (monthFilter && String(post.pubMonth) !== monthFilter) return false
      if (q) {
        const haystack = [post.title, post.excerpt, post.author?.name, post.formattedDate]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [normalizedPosts, authorFilter, yearFilter, monthFilter, searchQuery])

  const filtersActive = Boolean(authorFilter || yearFilter || monthFilter || searchQuery.trim())

  useEffect(() => {
    setCurrentPage(1)
  }, [authorFilter, yearFilter, monthFilter, searchQuery])

  useEffect(() => {
    if (window.AOS && typeof window.AOS.init === 'function') {
      window.AOS.init()
      if (typeof window.AOS.refreshHard === 'function') {
        window.AOS.refreshHard()
      }
    }
  }, [filteredPosts, currentPage])

  const featuredPost = !filtersActive ? filteredPosts[0] : null
  const listPosts = useMemo(
    () => (featuredPost ? filteredPosts.slice(1) : filteredPosts),
    [filteredPosts, featuredPost]
  )

  const paginatedPosts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE
    return listPosts.slice(start, start + ITEMS_PER_PAGE)
  }, [listPosts, currentPage])

  const totalPages = Math.max(1, Math.ceil(listPosts.length / ITEMS_PER_PAGE))

  const handlePageChange = (page) => {
    setCurrentPage(page)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const clearFilters = () => {
    setAuthorFilter('')
    setYearFilter('')
    setMonthFilter('')
    setSearchQuery('')
  }

  const renderPosts = () => {
    if (loading) {
      return (
        <div className="text-center py-5">
          <div className="spinner-border text-secondary" role="status" style={{ width: '3rem', height: '3rem' }}>
            <span className="visually-hidden">Loading blog posts…</span>
          </div>
        </div>
      )
    }

    if (error) {
      return <p className="text-center text-muted mt-4">{error}</p>
    }

    if (!featuredPost && paginatedPosts.length === 0) {
      return (
        <p className="text-center text-muted mt-4">
          {filtersActive
            ? 'No blog posts match these filters.'
            : 'No blog posts available at this time.'}
        </p>
      )
    }

    return (
      <>
        <div className="blog-posts-grid mt-4">
          {currentPage === 1 && featuredPost && (
            <BlogCard post={featuredPost} variant="featured" />
          )}
          {paginatedPosts.map((post) => (
            <BlogCard key={post.id} post={post} variant="default" />
          ))}
        </div>

        {totalPages > 1 && (
          <div className="mt-4">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </div>
        )}
      </>
    )
  }

  return (
    <div className="blog-page">
      <section className="subpage-hero d-flex align-items-center text-white text-center position-relative">
        <div className="parallax-bg" aria-hidden="true"></div>
        <div className="container position-relative z-1">
          <h1 className="display-3 fw-bold mb-2" data-aos="fade-up" data-aos-duration="1000">Blog</h1>
          <p className="lead" data-aos="fade-up" data-aos-duration="1000" data-aos-delay="200">
            Latest insights about SPAN and healthcare.
          </p>
        </div>
      </section>

      <main className="p-3 p-md-5 m-md-3 bg-light">
        <div className="container py-5">
          <h2 className="text-center display-5 fw-bold">Latest Posts</h2>

          {!loading && !error && normalizedPosts.length > 0 && (
            <div className="blog-filters mt-4 d-flex flex-wrap align-items-end gap-2 justify-content-between">
              <div className="blog-filters-left d-flex flex-wrap align-items-end gap-2">
                <div className="blog-filter-field blog-filter-author">
                  <label className="form-label small text-muted mb-1" htmlFor="blog-filter-author">
                    Author
                  </label>
                  <select
                    id="blog-filter-author"
                    className="form-select"
                    value={authorFilter}
                    onChange={(e) => setAuthorFilter(e.target.value)}
                  >
                    <option value="">All authors</option>
                    {authorOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="blog-filter-field blog-filter-year">
                  <label className="form-label small text-muted mb-1" htmlFor="blog-filter-year">
                    Year
                  </label>
                  <select
                    id="blog-filter-year"
                    className="form-select"
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                  >
                    <option value="">All years</option>
                    {yearOptions.map((year) => (
                      <option key={year} value={String(year)}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="blog-filter-field blog-filter-month">
                  <label className="form-label small text-muted mb-1" htmlFor="blog-filter-month">
                    Month
                  </label>
                  <select
                    id="blog-filter-month"
                    className="form-select"
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                  >
                    <option value="">All months</option>
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                {filtersActive && (
                  <button type="button" className="btn btn-outline-secondary" onClick={clearFilters}>
                    Clear
                  </button>
                )}
              </div>
              <div className="blog-filters-right blog-filter-field blog-filter-search">
                <label className="form-label small text-muted mb-1" htmlFor="blog-filter-search">
                  Search
                </label>
                <input
                  id="blog-filter-search"
                  type="search"
                  className="form-control"
                  placeholder="Search by keyword…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search blog posts"
                />
              </div>
            </div>
          )}

          {renderPosts()}
        </div>
      </main>
    </div>
  )
}

export default BlogPage

