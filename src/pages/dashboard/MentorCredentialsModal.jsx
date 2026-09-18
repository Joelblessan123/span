import React, { useState } from 'react'

export default function MentorCredentialsModal({ open, credentials, onClose }) {
  const [copied, setCopied] = useState('')
  if (!open || !credentials) return null

  const loginUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/login.html?mode=mentor`
      : 'https://spanationwide.org/login.html?mode=mentor'

  const copy = async (label, value) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      setCopied('')
    }
  }

  return (
    <>
      <div
        className="modal fade show"
        style={{ display: 'block', zIndex: 1060 }}
        onClick={(e) => {
          if (e.target.className.includes('modal fade show')) onClose()
        }}
      >
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                {credentials.action === 'reset_password' ? 'Mentor password reset' : 'Mentor login created'}
              </h5>
              <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
            </div>
            <div className="modal-body">
              <p className="mb-3">
                Share these credentials with <strong>{credentials.full_name || 'the mentor'}</strong>. They are shown
                once — copy them now. Mentors sign in under <strong>Mentor</strong> on the login page (username, not a
                SPAN email).
              </p>
              <div className="mb-3">
                <label className="form-label small text-muted mb-1">Username</label>
                <div className="input-group">
                  <input className="form-control font-monospace" readOnly value={credentials.username || ''} />
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => copy('username', credentials.username || '')}
                  >
                    {copied === 'username' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="mb-3">
                <label className="form-label small text-muted mb-1">Temporary password</label>
                <div className="input-group">
                  <input className="form-control font-monospace" readOnly value={credentials.temp_password || ''} />
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => copy('password', credentials.temp_password || '')}
                  >
                    {copied === 'password' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="mb-0">
                <label className="form-label small text-muted mb-1">Login link</label>
                <div className="input-group">
                  <input className="form-control small" readOnly value={loginUrl} />
                  <button type="button" className="btn btn-outline-secondary" onClick={() => copy('link', loginUrl)}>
                    {copied === 'link' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-dark" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" style={{ zIndex: 1059 }} />
    </>
  )
}
