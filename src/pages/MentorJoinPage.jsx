import React, { useEffect, useState } from 'react'
import { fileToBase64Payload, submitMentorJoin, validateMentorInvite } from '../lib/mentors'

function readInviteFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return (params.get('invite') || '').trim()
}

export default function MentorJoinPage() {
  const [invite] = useState(() => readInviteFromUrl())
  const [checking, setChecking] = useState(true)
  const [inviteError, setInviteError] = useState('')
  const [expiresAt, setExpiresAt] = useState(null)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!invite) {
        setInviteError('This page needs a valid invite link from SPAN.')
        setChecking(false)
        return
      }
      try {
        const result = await validateMentorInvite(invite)
        if (!cancelled) {
          setExpiresAt(result.expires_at || null)
          setChecking(false)
        }
      } catch (err) {
        if (!cancelled) {
          setInviteError(err.message || 'Invalid or expired invite link.')
          setChecking(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [invite])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError('')
    if (!photoFile) {
      setFormError('Please upload a photo.')
      return
    }
    if (photoFile.size > 5 * 1024 * 1024) {
      setFormError('Photo must be under 5 MB.')
      return
    }
    setSubmitting(true)
    try {
      const photo = await fileToBase64Payload(photoFile)
      const result = await submitMentorJoin({
        invite,
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        title: title.trim(),
        company: company.trim(),
        linkedin_url: linkedinUrl.trim(),
        ...photo,
      })
      setDone(result)
    } catch (err) {
      setFormError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="bg-light">
      <section className="subpage-hero d-flex align-items-center text-white text-center position-relative">
        <div className="parallax-bg" aria-hidden="true"></div>
        <div className="container position-relative z-1 py-5">
          <h1 className="display-5 fw-bold mb-2">Join as a SPAN Mentor</h1>
          <p className="lead mb-0">Complete your profile to access policy tools on the mentor dashboard.</p>
        </div>
      </section>

      <div className="container py-5" style={{ maxWidth: '640px' }}>
        {checking ? (
          <div className="text-center py-5">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Checking invite…</span>
            </div>
          </div>
        ) : inviteError ? (
          <div className="alert alert-danger">{inviteError}</div>
        ) : done ? (
          <div className="card shadow-sm">
            <div className="card-body p-4">
              <h2 className="h4 mb-3">You&apos;re all set</h2>
              <p className="mb-3">
                Thanks for joining SPAN. Your mentor profile is active
                {done.emailed
                  ? ', and we emailed your login details.'
                  : '. We could not email your password — save it below.'}
              </p>
              <p className="mb-2">
                <strong>Username:</strong>{' '}
                <span className="font-monospace">{done.username}</span>
              </p>
              {done.temp_password && (
                <p className="mb-3">
                  <strong>Temporary password:</strong>{' '}
                  <span className="font-monospace">{done.temp_password}</span>
                </p>
              )}
              <a className="btn btn-dark" href={done.login_url || '/login.html?mode=mentor'}>
                Go to Mentor login
              </a>
            </div>
          </div>
        ) : (
          <div className="card shadow-sm">
            <div className="card-body p-4">
              {expiresAt && (
                <p className="small text-muted mb-3">
                  Invite valid until {new Date(expiresAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}.
                </p>
              )}
              <form onSubmit={handleSubmit}>
                <div className="mb-3">
                  <label className="form-label" htmlFor="mentor-full-name">
                    Full name <span className="text-danger">*</span>
                  </label>
                  <input
                    id="mentor-full-name"
                    className="form-control"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    autoComplete="name"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="mentor-email">
                    Email <span className="text-danger">*</span>
                  </label>
                  <input
                    id="mentor-email"
                    type="email"
                    className="form-control"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="mentor-phone">
                    Phone <span className="text-danger">*</span>
                  </label>
                  <input
                    id="mentor-phone"
                    type="tel"
                    className="form-control"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    autoComplete="tel"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="mentor-title">
                    Title / role
                  </label>
                  <input
                    id="mentor-title"
                    className="form-control"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Chief Medical Officer"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="mentor-company">
                    Affiliation (company / organization)
                  </label>
                  <input
                    id="mentor-company"
                    className="form-control"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="e.g. Acme Health"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="mentor-linkedin">
                    LinkedIn URL
                  </label>
                  <input
                    id="mentor-linkedin"
                    type="url"
                    className="form-control"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    placeholder="https://www.linkedin.com/in/…"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="mentor-photo">
                    Photo <span className="text-danger">*</span>
                  </label>
                  <input
                    id="mentor-photo"
                    type="file"
                    className="form-control"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                    required
                  />
                  <div className="form-text">JPEG, PNG, or WebP · max 5 MB</div>
                </div>
                {formError && <div className="alert alert-danger py-2">{formError}</div>}
                <button type="submit" className="btn btn-dark w-100" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Create mentor profile'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
