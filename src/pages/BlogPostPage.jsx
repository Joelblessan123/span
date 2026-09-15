import React, { useEffect, useState } from 'react'
import { fetchPublicDirectoryMembers } from '../lib/publicData'
import { memberNameLookupKeys, memberSiteDisplayName } from '../lib/memberDisplayName'
import { fetchMediumBlogItems, findMediumBlogItem } from '../lib/mediumBlog'
import {
  absoluteUrl,
  descriptionFromHtml,
  setPageSeo,
  SEO_SITE_ORIGIN,
} from '../lib/documentSeo'
import '../pages/BlogPage.css'

const DEFAULT_BLOG_TITLE = 'Blog Post | SPAN - Students for Patient Advocacy Nationwide'
const DEFAULT_BLOG_DESCRIPTION = 'Read our latest blog post about SPAN and healthcare advocacy.'

const MEMBER_IMAGE_BASE_URL = 'https://qujzohvrbfsouakzocps.supabase.co/storage/v1/object/public/members-images'

// Helper functions from BlogPage
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

const resolveAuthor = (item, memberLookup) => {
  const defaultAuthor = { name: 'SPAN', link: '/index.html', avatar: '/images/index/logo-icon-light.svg' }
  const authorName = extractAuthorName(item)
  if (!authorName) {
    return defaultAuthor
  }
  const segments = authorName.split(/(?:,|&| and )/i).map((segment) => segment.trim()).filter(Boolean)
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
          const avatar = member.image
            ? (member.image.startsWith('http') ? member.image : `${MEMBER_IMAGE_BASE_URL}/${member.image}`)
            : '/images/index/logo-icon-light.svg'
          return {
            name: displayName,
            link: `/directory.html?search=${encodeURIComponent(displayName)}`,
            avatar
          }
        }
      }
    }
  }

  if (displayFallback && !/^students for patient advocacy/i.test(displayFallback)) {
    return {
      name: displayFallback,
      link: `/directory.html?search=${encodeURIComponent(displayFallback)}`,
      avatar: '/images/index/logo-icon-light.svg'
    }
  }

  return defaultAuthor
}

// Clean and sanitize HTML content for safe display
const sanitizeContent = (html, featuredImageUrl = null) => {
  if (!html) return ''
  // Remove script tags and their content
  let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
  // Remove style tags that might have dangerous content
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
  // Remove on* event handlers
  cleaned = cleaned.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '')
  
  // Remove the first image from content (since we display it separately as featured image)
  // This handles both standalone img tags and img tags wrapped in figure/div/p tags
  if (featuredImageUrl) {
    // Try to match the featured image URL in various formats
    const escapedUrl = featuredImageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Match img tag with the featured image URL
    cleaned = cleaned.replace(new RegExp(`<img[^>]*src=["']${escapedUrl}["'][^>]*>`, 'i'), '')
    // Match figure/div/p tags containing the featured image
    cleaned = cleaned.replace(new RegExp(`<(figure|div|p)[^>]*>\\s*<img[^>]*src=["']${escapedUrl}["'][^>]*>\\s*</(figure|div|p)>`, 'i'), '')
  } else {
    // If no featured image URL, just remove the first image tag
    cleaned = cleaned.replace(/<img[^>]*>/i, '')
  }
  
  // Ensure all links open in new tab
  cleaned = cleaned.replace(/<a\s+([^>]*href=["'][^"']*["'][^>]*)>/gi, (match, attrs) => {
    if (!attrs.includes('target=')) {
      return `<a ${attrs} target="_blank" rel="noopener noreferrer">`
    }
    return match
  })
  return cleaned
}

function BlogPostPage({ postId }) {
  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [members, setMembers] = useState([])

  useEffect(() => {
    async function fetchPost() {
      try {
        setLoading(true)
        
        // Fetch members for author resolution
        let membersData = []
        try {
          membersData = await fetchPublicDirectoryMembers({ requireRegistration: false })
        } catch (memberErr) {
          console.warn('Failed to fetch members for blog author:', memberErr)
        }
        setMembers(membersData)

        // Fetch Medium posts (live RSS + archived older stories)
        const feed = await fetchMediumBlogItems()
        if (!feed.ok && !feed.items.length) throw new Error(feed.error || 'Failed to fetch blog posts')
        const items = feed.items || []

        // Find the post by ID (using guid or link)
        const foundPost = findMediumBlogItem(items, postId)

        if (!foundPost) {
          setError('Post not found')
          setLoading(false)
          return
        }

        // Resolve author
        const memberLookup = buildMemberLookup(membersData || [])
        const author = resolveAuthor(foundPost, memberLookup)

        // Format date
        const estDate = new Date(`${foundPost.pubDate.replace(' ', 'T')}Z`)
        const formattedDate = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }).format(estDate)

        // Get featured image
        const descriptionMatch = foundPost.description?.match(/<img[^>]+src="([^"]+)"/)
        const image =
          descriptionMatch?.[1] ||
          (foundPost.thumbnail && String(foundPost.thumbnail).trim()) ||
          null

        // Sanitize and prepare content (remove featured image if it appears in content)
        const content = sanitizeContent(foundPost.content, image)

        setPost({
          title: foundPost.title,
          content,
          image,
          formattedDate,
          author,
          link: foundPost.link, // Keep original link for "View on Medium" option
          guid: foundPost.guid || foundPost.link,
          pubDate: foundPost.pubDate,
          descriptionHtml: foundPost.description || foundPost.content || '',
        })
        setError(null)
      } catch (err) {
        console.error('Error fetching post:', err)
        setError('Failed to load post')
      } finally {
        setLoading(false)
      }
    }

    if (postId) {
      fetchPost()
    }
  }, [postId])

  useEffect(() => {
    if (!post || !postId) return undefined

    const canonicalPath = `/blog-post.html?id=${encodeURIComponent(postId)}`
    const description =
      descriptionFromHtml(post.descriptionHtml || post.content, 160) || DEFAULT_BLOG_DESCRIPTION
    const title = `${post.title} | SPAN`
    const pageUrl = absoluteUrl(canonicalPath)

    setPageSeo({
      title,
      description,
      canonicalPath,
      image: post.image || '/images/index/preview.jpg',
      type: 'article',
      jsonLdId: 'span-blog-post-jsonld',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: post.title,
        description,
        image: post.image ? [absoluteUrl(post.image)] : undefined,
        datePublished: post.pubDate
          ? new Date(`${String(post.pubDate).replace(' ', 'T')}Z`).toISOString()
          : undefined,
        author: {
          '@type': 'Person',
          name: post.author?.name || 'SPAN',
        },
        publisher: {
          '@type': 'Organization',
          name: 'Students for Patient Advocacy Nationwide',
          url: SEO_SITE_ORIGIN,
          logo: {
            '@type': 'ImageObject',
            url: `${SEO_SITE_ORIGIN}/assets/images/index/logo-icon-dark.svg`,
          },
        },
        mainEntityOfPage: {
          '@type': 'WebPage',
          '@id': pageUrl,
        },
        isPartOf: {
          '@type': 'WebSite',
          name: 'SPAN',
          url: SEO_SITE_ORIGIN,
        },
      },
    })

    return () => {
      setPageSeo({
        title: DEFAULT_BLOG_TITLE,
        description: DEFAULT_BLOG_DESCRIPTION,
        canonicalPath: '/blog-post.html',
        image: '/images/index/preview.jpg',
        type: 'article',
        jsonLdId: 'span-blog-post-jsonld',
        jsonLd: null,
      })
    }
  }, [post, postId])

  useEffect(() => {
    if (window.AOS && typeof window.AOS.init === 'function') {
      window.AOS.init()
    }
  }, [post])

  if (loading) {
    return (
      <div className="blog-page">
        <div className="text-center py-5">
          <div className="spinner-border text-secondary" role="status" style={{ width: '3rem', height: '3rem' }}>
            <span className="visually-hidden">Loading post…</span>
          </div>
        </div>
      </div>
    )
  }

  if (error || !post) {
    return (
      <div className="blog-page">
        <div className="container py-5">
          <div className="text-center">
            <h2>Post Not Found</h2>
            <p className="text-muted">{error || 'The requested blog post could not be found.'}</p>
            <a href="/blog.html" className="btn btn-dark mt-3">
              Back to Blog
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="blog-page">
      <section className="subpage-hero d-flex align-items-center text-white text-center position-relative">
        <div className="parallax-bg" aria-hidden="true"></div>
        <div className="container position-relative z-1">
          <a href="/blog.html" className="text-white text-decoration-none mb-3 d-inline-block">
            <i className="bi bi-arrow-left me-2"></i>Back to Blog
          </a>
          <h1 className="display-4 fw-bold mb-2" data-aos="fade-up" data-aos-duration="1000">{post.title}</h1>
        </div>
      </section>

      <main className="p-3 p-md-5 m-md-3 bg-light">
        <div className="container py-5">
          <article className="blog-post-content">
            {/* Post Meta */}
            <div className="mb-4 pb-3 border-bottom">
              <div className="d-flex align-items-center flex-wrap gap-3 text-muted">
                <small>{post.formattedDate}</small>
                {post.author && (
                  <>
                    <span>·</span>
                    <div className="d-flex align-items-center">
                      {post.author.avatar && (
                        <img
                          src={post.author.avatar}
                          alt={post.author.name}
                          height="24"
                          width="24"
                          className="rounded-circle me-2"
                          style={{ objectFit: 'cover' }}
                        />
                      )}
                      {post.author.link ? (
                        <a href={post.author.link} className="text-muted text-decoration-none">
                          <small>{post.author.name}</small>
                        </a>
                      ) : (
                        <small>{post.author.name}</small>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Featured Image */}
            {post.image && (
              <div className="mb-4">
                <img
                  src={post.image}
                  alt={post.title}
                  className="img-fluid rounded"
                  style={{ width: '100%', maxHeight: '500px', objectFit: 'cover' }}
                />
              </div>
            )}

            {/* Post Content */}
            <div
              className="blog-post-body"
              dangerouslySetInnerHTML={{ __html: post.content }}
              style={{
                lineHeight: '1.8',
                fontSize: '1.1rem'
              }}
            />

            {/* View on Medium Link */}
            <div className="mt-5 pt-4 border-top text-center">
              <a
                href={post.link}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline-dark"
              >
                <i className="bi bi-box-arrow-up-right me-2"></i>
                View on Medium
              </a>
            </div>
          </article>
        </div>
      </main>
    </div>
  )
}

export default BlogPostPage
