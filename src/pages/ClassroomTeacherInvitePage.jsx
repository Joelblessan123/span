import React, { useEffect, useMemo, useState } from 'react'
import SchoolDirectoryPicker from '../components/SchoolDirectoryPicker'
import { submitClassroomInviteJoin, validateClassroomInvite } from '../lib/classroom'

const NEW_SCHOOL_VALUE = '__new__'

function readInviteFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return (params.get('invite') || '').trim()
}

function schoolOptionLabel(s) {
  const place = [s.city, s.state].filter(Boolean).join(', ')
  return place ? `${s.name} (${place})` : s.name
}

export default function ClassroomTeacherInvitePage() {
  const [invite] = useState(() => readInviteFromUrl())
  const [checking, setChecking] = useState(true)
  const [inviteError, setInviteError] = useState('')
  const [inviteMeta, setInviteMeta] = useState(null)

  const [schoolChoice, setSchoolChoice] = useState('') // school_id or NEW_SCHOOL_VALUE
  const [directoryPick, setDirectoryPick] = useState(null)
  const [newSchoolContactEmail, setNewSchoolContactEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [done, setDone] = useState(null)

  const schools = useMemo(
    () => (Array.isArray(inviteMeta?.schools) ? inviteMeta.schools : []),
    [inviteMeta],
  )
  const schoolPinned = !!inviteMeta?.school_pinned
  const allowNewSchool = !!inviteMeta?.allow_new_school && !schoolPinned
  const addingNewSchool = allowNewSchool && schoolChoice === NEW_SCHOOL_VALUE
  const selectedSchool = schools.find((s) => s.school_id === schoolChoice) || null

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!invite) {
        setInviteError('This page needs a valid invite link from SPAN.')
        setChecking(false)
        return
      }
      try {
        const result = await validateClassroomInvite(invite)
        if (!cancelled) {
          const list = Array.isArray(result.schools) ? result.schools : []
          const canAdd = !!result.allow_new_school && !result.school_pinned
          if (!list.length && !canAdd) {
            setInviteError(
              'No schools are available to join yet. Ask SPAN to add your school or send an open invite.',
            )
          } else {
            setInviteMeta(result)
            if (result.school_id) setSchoolChoice(result.school_id)
            else if (list.length === 1 && !canAdd) setSchoolChoice(list[0].school_id)
            else if (!list.length && canAdd) setSchoolChoice(NEW_SCHOOL_VALUE)
            else setSchoolChoice('')
          }
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
    if (!schoolChoice) {
      setFormError('Select your school from the list, or add a new school from the directory.')
      return
    }
    if (addingNewSchool && !directoryPick?.nces_id) {
      setFormError('Select your school from the directory (state → city/search → school).')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        invite,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
      }
      if (addingNewSchool) {
        payload.nces_id = directoryPick.nces_id
        payload.school_name = directoryPick.name
        payload.school_city = directoryPick.city || ''
        payload.school_state = directoryPick.state || ''
        payload.school_contact_email = newSchoolContactEmail.trim() || email.trim()
      } else {
        payload.school_id = schoolChoice
      }
      const result = await submitClassroomInviteJoin(payload)
      setDone(result)
    } catch (err) {
      setFormError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    !!schoolChoice &&
    (!addingNewSchool || !!directoryPick?.nces_id)

  return (
    <main className="bg-light">
      <section className="subpage-hero d-flex align-items-center text-white text-center position-relative">
        <div className="parallax-bg" aria-hidden="true" />
        <div className="container position-relative z-1 py-5">
          <h1 className="display-5 fw-bold mb-2">Join SPAN Classroom</h1>
          <p className="lead mb-0">
            {selectedSchool
              ? `Create your teacher login for ${selectedSchool.name}.`
              : addingNewSchool
                ? 'Pick your school from the directory and create your teacher login.'
                : 'Pick your school and create your teacher login.'}
          </p>
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
            <div className="card-body">
              <h2 className="h4 mb-3">You&apos;re all set</h2>
              <p className="mb-2">
                {done.school_name ? (
                  <>
                    {done.created_school ? (
                      <>
                        <strong>{done.school_name}</strong> was added
                      </>
                    ) : (
                      <>
                        You&apos;re registered at <strong>{done.school_name}</strong>
                      </>
                    )}
                    {done.email ? <> with login <strong>{done.email}</strong></> : null}.
                  </>
                ) : (
                  <>Your teacher account is ready{done.email ? <> for <strong>{done.email}</strong></> : null}.</>
                )}
              </p>
              {done.emailed ? (
                <p className="text-muted small">Check your email for Classroom login instructions.</p>
              ) : done.temp_password ? (
                <div className="alert alert-warning small">
                  We couldn&apos;t email credentials. Temporary password:{' '}
                  <code>{done.temp_password}</code>
                </div>
              ) : (
                <p className="text-muted small">Use your existing password for this email if you already have a login.</p>
              )}
              <a className="btn btn-dark" href={done.login_url || '/login.html?mode=classroom'}>
                Open Classroom login
              </a>
            </div>
          </div>
        ) : (
          <form className="card shadow-sm" onSubmit={handleSubmit}>
            <div className="card-body">
              {inviteMeta?.expires_at && (
                <p className="small text-muted mb-3">
                  Invite valid until{' '}
                  {new Date(inviteMeta.expires_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}.
                </p>
              )}

              <div className="mb-3">
                <label className="form-label" htmlFor="ci-school">
                  School
                </label>
                <select
                  id="ci-school"
                  className="form-select"
                  required
                  value={schoolChoice}
                  disabled={schoolPinned}
                  onChange={(e) => {
                    setSchoolChoice(e.target.value)
                    setDirectoryPick(null)
                  }}
                >
                  {!schoolPinned && (
                    <option value="">
                      {schools.length ? 'Select your school…' : 'Add a school from the directory…'}
                    </option>
                  )}
                  {schools.map((s) => (
                    <option key={s.school_id} value={s.school_id}>
                      {schoolOptionLabel(s)}
                    </option>
                  ))}
                  {allowNewSchool && (
                    <option value={NEW_SCHOOL_VALUE}>My school isn&apos;t listed — pick from directory</option>
                  )}
                </select>
                <small className="text-muted">
                  {schoolPinned
                    ? 'This invite is locked to the school above.'
                    : 'Prefer an existing Classroom school when you can. Otherwise pick yours from the US public school directory.'}
                </small>
              </div>

              {addingNewSchool && (
                <div className="mb-4 p-3 border rounded bg-light">
                  <h2 className="h6 text-uppercase text-muted mb-3">Find your school</h2>
                  <SchoolDirectoryPicker
                    idPrefix="ci-dir"
                    value={directoryPick}
                    onChange={setDirectoryPick}
                  />
                  <div className="mt-3">
                    <label className="form-label" htmlFor="ci-new-school-contact">
                      School contact email (optional)
                    </label>
                    <input
                      id="ci-new-school-contact"
                      type="email"
                      className="form-control"
                      value={newSchoolContactEmail}
                      onChange={(e) => setNewSchoolContactEmail(e.target.value)}
                      placeholder="Defaults to your teacher email"
                    />
                  </div>
                </div>
              )}

              <h2 className="h6 text-uppercase text-muted mb-3">Teacher</h2>
              <div className="row g-2 mb-3">
                <div className="col-sm-6">
                  <label className="form-label" htmlFor="ci-first">
                    First name
                  </label>
                  <input
                    id="ci-first"
                    className="form-control"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="col-sm-6">
                  <label className="form-label" htmlFor="ci-last">
                    Last name
                  </label>
                  <input
                    id="ci-last"
                    className="form-control"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
              <div className="mb-3">
                <label className="form-label" htmlFor="ci-email">
                  School email
                </label>
                <input
                  id="ci-email"
                  type="email"
                  className="form-control"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <small className="text-muted">We&apos;ll create your Classroom login and email credentials.</small>
              </div>

              {formError && (
                <div className="alert alert-danger py-2 small" role="alert">
                  {formError}
                </div>
              )}

              <button type="submit" className="btn btn-dark w-100" disabled={submitting || !canSubmit}>
                {submitting
                  ? 'Submitting…'
                  : addingNewSchool
                    ? 'Add school & create login'
                    : 'Create teacher login'}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  )
}
