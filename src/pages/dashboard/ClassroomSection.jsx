import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createClassroomInviteLink,
  deactivateSchool,
  fetchAllClasses,
  fetchSchools,
  fetchTeachers,
  insertSchool,
  insertTeacher,
  listClassroomInvites,
  localizeClassroomInviteUrl,
  provisionTeacher,
  revokeClassroomInvite,
  setSchoolActive,
  setTeacherActive,
} from '../../lib/classroom'
import SchoolDirectoryPicker from '../../components/SchoolDirectoryPicker'
import { supabase } from '../../lib/supabase'
import './ClassroomSection.css'

function formatInviteExpiry(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
  } catch {
    return '—'
  }
}

export default function ClassroomSection({ sectionId, sectionOrder }) {
  const [schools, setSchools] = useState([])
  const [teachers, setTeachers] = useState([])
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showAddSchool, setShowAddSchool] = useState(false)
  const [showAddTeacher, setShowAddTeacher] = useState(false)
  const [provisioningId, setProvisioningId] = useState(null)
  const [newSchoolPick, setNewSchoolPick] = useState(null)
  const [newSchoolContactEmail, setNewSchoolContactEmail] = useState('')
  const [newTeacher, setNewTeacher] = useState({
    schoolId: '',
    firstName: '',
    lastName: '',
    email: '',
  })
  /** Soft-removed (active=false) schools/teachers stay in DB; hide them from the Directory by default. */
  const [showRemoved, setShowRemoved] = useState(false)
  /** Test teacher accounts (classroom_teachers.is_test) stay hidden unless toggled on. */
  const [showTest, setShowTest] = useState(false)
  const testTeacherCount = useMemo(() => teachers.filter((t) => t.is_test).length, [teachers])
  const [activeInvites, setActiveInvites] = useState([])
  const [inviteBusy, setInviteBusy] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  /** '' = open invite (teacher picks school on form); otherwise pin to school_id */
  const [inviteSchoolId, setInviteSchoolId] = useState('')

  const activeSchools = useMemo(
    () => schools.filter((s) => s.active !== false),
    [schools],
  )
  const activeTeachers = useMemo(
    () => teachers.filter((t) => t.active !== false),
    [teachers],
  )
  const removedCount =
    schools.length - activeSchools.length + (teachers.length - activeTeachers.length)

  const tree = useMemo(() => {
    const teachersBySchool = new Map()
    for (const t of teachers) {
      const key = t.school_id
      if (!teachersBySchool.has(key)) teachersBySchool.set(key, [])
      teachersBySchool.get(key).push(t)
    }
    const classesByTeacher = new Map()
    for (const c of classes) {
      const key = c.teacher_id
      if (!classesByTeacher.has(key)) classesByTeacher.set(key, [])
      classesByTeacher.get(key).push(c)
    }
    const schoolList = showRemoved ? schools : activeSchools
    return schoolList.map((school) => {
      const rawTeachers = teachersBySchool.get(school.school_id) || []
      const schoolTeachers = (showRemoved
        ? rawTeachers
        : rawTeachers.filter((t) => t.active !== false)
      )
        .filter((t) => showTest || !t.is_test)
        .map((teacher) => ({
          ...teacher,
          classes: classesByTeacher.get(teacher.teacher_id) || [],
        }))
      return { ...school, teachers: schoolTeachers }
    })
  }, [schools, teachers, classes, showRemoved, showTest, activeSchools])

  const orphanClasses = useMemo(() => {
    const teacherIds = new Set(teachers.map((t) => t.teacher_id))
    const schoolIds = new Set(schools.map((s) => s.school_id))
    return classes.filter(
      (c) => !teacherIds.has(c.teacher_id) || !schoolIds.has(c.school_id),
    )
  }, [schools, teachers, classes])

  const loadInvites = useCallback(async () => {
    try {
      const invites = await listClassroomInvites()
      setActiveInvites(invites)
    } catch (err) {
      console.warn('classroom invites list', err)
      setActiveInvites([])
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [schoolRows, teacherRows, classRows] = await Promise.all([
        fetchSchools(),
        fetchTeachers(),
        fetchAllClasses(),
      ])
      setSchools(schoolRows)
      setTeachers(teacherRows)
      setClasses(classRows)
      await loadInvites()
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to load classroom data.')
    } finally {
      setLoading(false)
    }
  }, [loadInvites])

  useEffect(() => {
    load()
  }, [load])

  async function copyInviteUrl(joinUrl, expiresAt) {
    const url = localizeClassroomInviteUrl(joinUrl)
    try {
      await navigator.clipboard.writeText(url)
      setMessage(
        `Invite link copied. Valid until ${formatInviteExpiry(expiresAt)}.`,
      )
    } catch {
      window.prompt('Copy this Classroom invite link:', url)
      setMessage(url)
    }
  }

  function openInviteModal(preselectedSchoolId = '') {
    setInviteSchoolId(preselectedSchoolId || '')
    setShowInviteModal(true)
  }

  async function handleCreateInviteFromModal(e) {
    e.preventDefault()
    setInviteBusy(true)
    setMessage('')
    setError('')
    try {
      const schoolId = inviteSchoolId || null
      const schoolLabel = schoolId
        ? activeSchools.find((s) => s.school_id === schoolId)?.name || null
        : 'Open teacher invite'
      if (schoolId && !activeSchools.some((s) => s.school_id === schoolId)) {
        setError('Select a school from the list, or leave blank for an open invite.')
        setInviteBusy(false)
        return
      }

      const result = await createClassroomInviteLink({
        schoolId,
        label: schoolLabel,
      })
      setShowInviteModal(false)
      await copyInviteUrl(result.join_url, result.expires_at)
      await loadInvites()
    } catch (err) {
      setError(err.message || 'Could not create invite link.')
    } finally {
      setInviteBusy(false)
    }
  }

  async function handleRevokeInvite(invite) {
    const kindLabel =
      invite.kind === 'teacher'
        ? `teacher invite${invite.school_name ? ` (${invite.school_name})` : ''}`
        : 'school + teacher invite'
    if (!window.confirm(`Revoke this ${kindLabel}? The link will stop working immediately.`)) return
    setInviteBusy(true)
    setError('')
    try {
      await revokeClassroomInvite(invite.invite_id)
      setMessage('Invite revoked.')
      await loadInvites()
    } catch (err) {
      setError(err.message || 'Could not revoke invite.')
    } finally {
      setInviteBusy(false)
    }
  }

  useEffect(() => {
    if (activeSchools.length && !newTeacher.schoolId) {
      setNewTeacher((t) => ({ ...t, schoolId: activeSchools[0].school_id }))
    }
  }, [activeSchools, newTeacher.schoolId])

  function openAddTeacher(schoolId) {
    const preferred =
      schoolId ||
      (activeSchools.some((s) => s.school_id === newTeacher.schoolId)
        ? newTeacher.schoolId
        : activeSchools[0]?.school_id) ||
      ''
    setNewTeacher((t) => ({
      ...t,
      schoolId: preferred,
    }))
    setShowAddTeacher(true)
  }

  async function handleAddSchool(e) {
    e.preventDefault()
    setMessage('')
    setError('')
    if (!newSchoolPick?.nces_id || !newSchoolPick?.name) {
      setError('Select a school from the directory.')
      return
    }
    try {
      const ncesId = String(newSchoolPick.nces_id).trim()
      const { data: existing } = await supabase
        .from('classroom_schools')
        .select('school_id, name, active')
        .eq('nces_id', ncesId)
        .maybeSingle()
      if (existing) {
        if (existing.active === false) {
          await setSchoolActive(existing.school_id, true)
          setMessage(`Reactivated ${existing.name}.`)
        } else {
          setMessage(`${existing.name} is already in Classroom.`)
        }
        setShowAddSchool(false)
        setNewSchoolPick(null)
        setNewSchoolContactEmail('')
        await load()
        return
      }
      await insertSchool({
        nces_id: ncesId,
        name: newSchoolPick.name.trim(),
        city: newSchoolPick.city || null,
        state: newSchoolPick.state || null,
        contact_email: newSchoolContactEmail.trim() || null,
      })
      setShowAddSchool(false)
      setNewSchoolPick(null)
      setNewSchoolContactEmail('')
      setMessage('School added.')
      await load()
    } catch (err) {
      setError(err.message || 'Could not add school.')
    }
  }

  function formatProvisionMessage(result, email) {
    if (result.emailed) {
      return result.created_new_user
        ? `Teacher added. Login created and emailed to ${email}.`
        : `Teacher linked to existing account; login email sent to ${email}.`
    }
    if (result.temp_password) {
      return `Teacher linked, but email failed. Share this temporary password for ${email}: ${result.temp_password}`
    }
    return `Teacher linked to ${email}. Email was not sent — ask them to use Classroom login with their existing password.`
  }

  async function handleAddTeacher(e) {
    e.preventDefault()
    setMessage('')
    setError('')
    try {
      const teacher = await insertTeacher({
        school_id: newTeacher.schoolId,
        first_name: newTeacher.firstName.trim(),
        last_name: newTeacher.lastName.trim(),
        email: newTeacher.email.trim().toLowerCase(),
      })
      setShowAddTeacher(false)
      const email = newTeacher.email.trim().toLowerCase()
      setNewTeacher({
        schoolId: activeSchools[0]?.school_id || '',
        firstName: '',
        lastName: '',
        email: '',
      })

      setProvisioningId(teacher.teacher_id)
      try {
        const result = await provisionTeacher(teacher.teacher_id)
        setMessage(formatProvisionMessage(result, email))
      } catch (provErr) {
        console.error(provErr)
        setError(
          `Teacher saved, but login provisioning failed: ${provErr.message || 'unknown error'}. Use “Create login” on their row to retry.`,
        )
      } finally {
        setProvisioningId(null)
      }
      await load()
    } catch (err) {
      setError(err.message || 'Could not add teacher.')
    }
  }

  async function handleProvisionTeacher(teacher) {
    setMessage('')
    setError('')
    setProvisioningId(teacher.teacher_id)
    try {
      const result = await provisionTeacher(teacher.teacher_id)
      setMessage(formatProvisionMessage(result, teacher.email))
      await load()
    } catch (err) {
      setError(err.message || 'Provisioning failed.')
    } finally {
      setProvisioningId(null)
    }
  }

  async function handleRemoveSchool(school) {
    const teacherCount = (teachers || []).filter((t) => t.school_id === school.school_id).length
    const ok = window.confirm(
      `Remove “${school.name}” from Classroom?\n\n` +
        `This deactivates the school` +
        (teacherCount ? ` and its ${teacherCount} teacher${teacherCount === 1 ? '' : 's'}` : '') +
        `. Classes stay in the database, but teachers can’t log in and students can’t join. Use “Show removed” to reactivate later.`,
    )
    if (!ok) return
    setMessage('')
    setError('')
    try {
      await deactivateSchool(school.school_id)
      setMessage(`Removed ${school.name}. Turn on “Show removed” if you need to reactivate.`)
      await load()
    } catch (err) {
      setError(err.message || 'Could not remove school.')
    }
  }

  async function handleReactivateSchool(school) {
    setMessage('')
    setError('')
    try {
      await setSchoolActive(school.school_id, true)
      setMessage(`Reactivated ${school.name}. Reactivate teachers separately if needed.`)
      await load()
    } catch (err) {
      setError(err.message || 'Could not reactivate school.')
    }
  }

  async function handleRemoveTeacher(teacher) {
    const name = `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim() || teacher.email
    const ok = window.confirm(
      `Remove teacher ${name}?\n\n` +
        `They will lose Classroom access. Their classes remain. Use “Show removed” to reactivate later.`,
    )
    if (!ok) return
    setMessage('')
    setError('')
    try {
      await setTeacherActive(teacher.teacher_id, false)
      setMessage(`Removed ${name}. Turn on “Show removed” if you need to reactivate.`)
      await load()
    } catch (err) {
      setError(err.message || 'Could not remove teacher.')
    }
  }

  async function handleReactivateTeacher(teacher) {
    const name = `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim() || teacher.email
    setMessage('')
    setError('')
    try {
      await setTeacherActive(teacher.teacher_id, true)
      setMessage(`Reactivated ${name}.`)
      await load()
    } catch (err) {
      setError(err.message || 'Could not reactivate teacher.')
    }
  }

  return (
    <section id={sectionId} className="mt-5 dashboard-section-anchor classroom-exec-section" style={{ order: sectionOrder }}>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h3 className="mb-1">Classroom</h3>
          <p className="text-muted mb-0">
            Create teacher invite links pinned to a school (login emailed automatically), or add
            manually. Teachers manage classes at{' '}
            <a href="/classroom/dashboard.html">classroom/dashboard.html</a>; students join via{' '}
            <a href="/classroom/join.html">classroom/join.html</a>.
          </p>
        </div>
        <div className="d-flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-sm btn-dark"
            disabled={inviteBusy}
            onClick={() => openInviteModal()}
          >
            <i className="bi bi-link-45deg me-1" />
            {inviteBusy ? 'Working…' : 'Create teacher invite'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-dark"
            onClick={() => {
              setNewSchoolPick(null)
              setNewSchoolContactEmail('')
              setShowAddSchool(true)
            }}
          >
            <i className="bi bi-plus-circle me-1" />
            Add school
          </button>
          <a
            href="/classroom/dashboard.html"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm btn-outline-dark"
            title="Exec console: SPAN materials for all classes and teacher workspaces"
          >
            <i className="bi bi-collection me-1" aria-hidden="true" />
            SPAN materials
          </a>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => openAddTeacher()}
            disabled={activeSchools.length === 0}
          >
            <i className="bi bi-person-plus me-1" />
            Add teacher manually
          </button>
        </div>
      </div>

      {error && <div className="alert alert-danger py-2">{error}</div>}
      {message && <div className="alert alert-success py-2 text-break">{message}</div>}

      <div className="card shadow-sm mb-3">
        <div className="card-header bg-white d-flex flex-wrap justify-content-between align-items-center gap-2">
          <h5 className="mb-0">Active invites</h5>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            disabled={inviteBusy || loading}
            onClick={loadInvites}
          >
            Refresh
          </button>
        </div>
        <div className="card-body py-2">
          <p className="small text-muted mb-2">
            Open invites: teachers pick an existing Classroom school, or add theirs from the NCES directory
            (state → city/search → select). Optionally pin a link to one school. Revoke to invalidate a
            specific link.
          </p>
          {activeInvites.length === 0 ? (
            <p className="small text-muted mb-0">No active invites. Create a teacher invite to get started.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>School / note</th>
                    <th>Expires</th>
                    <th>Uses</th>
                    <th className="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeInvites.map((inv) => (
                    <tr key={inv.invite_id}>
                      <td className="small">
                        {inv.kind === 'teacher' ? 'Teacher' : inv.kind}
                      </td>
                      <td className="small">
                        {inv.school_name || inv.label || 'Open (teacher picks school)'}
                      </td>
                      <td className="small">{formatInviteExpiry(inv.expires_at)}</td>
                      <td className="small">{inv.use_count ?? 0}</td>
                      <td className="text-end">
                        <div className="d-inline-flex flex-wrap gap-1 justify-content-end">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-dark"
                            disabled={inviteBusy}
                            onClick={() => copyInviteUrl(inv.join_url, inv.expires_at)}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            disabled={inviteBusy}
                            onClick={() => handleRevokeInvite(inv)}
                          >
                            Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-4">
          <div className="spinner-border text-secondary" role="status" />
        </div>
      ) : (
        <div className="card shadow-sm">
          <div className="card-header bg-white d-flex flex-wrap justify-content-between align-items-center gap-2">
            <h5 className="mb-0">Directory</h5>
            <div className="d-flex flex-wrap align-items-center gap-3">
              {removedCount > 0 && (
                <div className="form-check mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="classroom-show-removed"
                    checked={showRemoved}
                    onChange={(e) => setShowRemoved(e.target.checked)}
                  />
                  <label className="form-check-label small" htmlFor="classroom-show-removed">
                    Show removed ({removedCount})
                  </label>
                </div>
              )}
              {testTeacherCount > 0 && (
                <div className="form-check mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="classroom-show-test"
                    checked={showTest}
                    onChange={(e) => setShowTest(e.target.checked)}
                  />
                  <label className="form-check-label small" htmlFor="classroom-show-test">
                    Show test accounts ({testTeacherCount})
                  </label>
                </div>
              )}
              <span className="small text-muted">
                {activeSchools.length} school{activeSchools.length === 1 ? '' : 's'} ·{' '}
                {activeTeachers.length} teacher{activeTeachers.length === 1 ? '' : 's'} ·{' '}
                {classes.length} class{classes.length === 1 ? '' : 'es'}
              </span>
            </div>
          </div>
          <div className="classroom-scroll classroom-exec-tree">
            {tree.length === 0 ? (
              <p className="text-muted p-3 mb-0">
                {schools.length === 0
                  ? 'No schools yet. Add a school to get started.'
                  : 'No active schools. Turn on “Show removed” to reactivate one.'}
              </p>
            ) : (
              tree.map((school) => (
                <div key={school.school_id} className="classroom-school-block">
                  <div className="classroom-school-head">
                    <div className="min-w-0">
                      <div className="d-flex flex-wrap align-items-center gap-2">
                        <strong className="text-truncate">{school.name}</strong>
                        <span className={`badge ${school.active ? 'bg-success' : 'bg-secondary'}`}>
                          {school.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="small text-muted text-truncate">
                        {[school.city, school.state].filter(Boolean).join(', ') || 'No location'}
                        {school.contact_email ? ` · ${school.contact_email}` : ''}
                      </div>
                    </div>
                    <div className="d-flex flex-wrap gap-2 flex-shrink-0">
                      {school.active ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-dark"
                            disabled={inviteBusy}
                            onClick={() => openInviteModal(school.school_id)}
                            title="Create invite link for a teacher at this school"
                          >
                            <i className="bi bi-link-45deg me-1" aria-hidden="true" />
                            Teacher invite
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => openAddTeacher(school.school_id)}
                          >
                            Add teacher
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => handleRemoveSchool(school)}
                            title="Remove school"
                            aria-label={`Remove ${school.name}`}
                          >
                            <i className="bi bi-trash" aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success"
                          onClick={() => handleReactivateSchool(school)}
                        >
                          Reactivate school
                        </button>
                      )}
                    </div>
                  </div>

                  {school.teachers.length === 0 ? (
                    <p className="classroom-empty-note mb-0">No teachers at this school yet.</p>
                  ) : (
                    school.teachers.map((teacher) => (
                      <div key={teacher.teacher_id} className="classroom-teacher-block">
                        <div className="classroom-teacher-head">
                          <div className="min-w-0">
                            <div className="d-flex flex-wrap align-items-center gap-2">
                              <span className="fw-semibold">
                                {teacher.first_name} {teacher.last_name}
                              </span>
                              {!teacher.active ? (
                                <span className="badge bg-secondary">Inactive</span>
                              ) : teacher.user_id ? (
                                <span className="badge bg-success">Linked</span>
                              ) : (
                                <span className="badge bg-warning text-dark">Unlinked</span>
                              )}
                            </div>
                            <div className="small text-muted text-truncate">{teacher.email}</div>
                          </div>
                          <div className="d-flex flex-wrap gap-2 flex-shrink-0">
                            {teacher.active ? (
                              <>
                                <a
                                  href={`/classroom/dashboard.html?viewAsTeacher=${encodeURIComponent(teacher.teacher_id)}`}
                                  className="btn btn-sm btn-outline-dark"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Open this teacher's classes and materials in SPAN Classroom"
                                >
                                  <i className="bi bi-box-arrow-up-right me-1" aria-hidden="true" />
                                  View as
                                </a>
                                {!teacher.user_id && (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-dark"
                                    disabled={provisioningId === teacher.teacher_id}
                                    onClick={() => handleProvisionTeacher(teacher)}
                                  >
                                    {provisioningId === teacher.teacher_id ? 'Creating…' : 'Create login'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={() => handleRemoveTeacher(teacher)}
                                  title="Remove teacher"
                                  aria-label={`Remove ${teacher.first_name} ${teacher.last_name}`}
                                >
                                  <i className="bi bi-trash" aria-hidden="true" />
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-success"
                                onClick={() => handleReactivateTeacher(teacher)}
                              >
                                Reactivate
                              </button>
                            )}
                          </div>
                        </div>

                        {teacher.classes.length === 0 ? (
                          <p className="classroom-empty-note mb-0">No classes yet (teacher creates these).</p>
                        ) : (
                          <ul className="classroom-class-list">
                            {teacher.classes.map((c) => (
                              <li key={c.class_id} className="classroom-class-item">
                                <div className="min-w-0">
                                  <div className="fw-medium text-truncate">
                                    {c.name}
                                    {c.term ? <span className="text-muted fw-normal"> · {c.term}</span> : null}
                                  </div>
                                  <div className="small">
                                    Join code <code>{c.join_code}</code>
                                  </div>
                                </div>
                                <span className={`badge ${c.archived ? 'bg-secondary' : 'bg-success'} flex-shrink-0`}>
                                  {c.archived ? 'Archived' : 'Active'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ))
            )}

            {orphanClasses.length > 0 && (
              <div className="classroom-school-block">
                <div className="classroom-school-head">
                  <strong>Unassigned classes</strong>
                </div>
                <ul className="classroom-class-list">
                  {orphanClasses.map((c) => (
                    <li key={c.class_id} className="classroom-class-item">
                      <div className="min-w-0">
                        <div className="fw-medium text-truncate">{c.name}</div>
                        <div className="small text-muted text-truncate">
                          {c.classroom_teachers
                            ? `${c.classroom_teachers.first_name} ${c.classroom_teachers.last_name}`
                            : 'Unknown teacher'}
                          {' · '}
                          <code>{c.join_code}</code>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {showInviteModal && (
        <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-scrollable">
            <form className="modal-content" onSubmit={handleCreateInviteFromModal}>
              <div className="modal-header">
                <h5 className="modal-title">Create teacher invite</h5>
                <button type="button" className="btn-close" onClick={() => setShowInviteModal(false)} />
              </div>
              <div className="modal-body">
                <p className="small text-muted">
                  Leave school blank for an open invite: teachers pick an existing Classroom school or add
                  theirs from the public school directory. Or pin the link to one school.
                </p>
                <div className="mb-2">
                  <label className="form-label" htmlFor="invite-school-select">
                    School (optional pin)
                  </label>
                  <select
                    id="invite-school-select"
                    className="form-select"
                    value={inviteSchoolId}
                    onChange={(e) => setInviteSchoolId(e.target.value)}
                  >
                    <option value="">
                      Open — teacher picks a school or adds theirs
                    </option>
                    {activeSchools.map((s) => (
                      <option key={s.school_id} value={s.school_id}>
                        {s.name}
                        {s.city || s.state ? ` (${[s.city, s.state].filter(Boolean).join(', ')})` : ''}
                      </option>
                    ))}
                  </select>
                  {activeSchools.length === 0 && (
                    <small className="text-muted d-block mt-1">
                      No schools in the directory yet — an open invite still works; teachers can add their school
                      on the join form.
                    </small>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => setShowInviteModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-dark" disabled={inviteBusy}>
                  {inviteBusy ? 'Creating…' : 'Create & copy link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddSchool && (
        <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-scrollable">
            <form className="modal-content" onSubmit={handleAddSchool}>
              <div className="modal-header">
                <h5 className="modal-title">Add school</h5>
                <button type="button" className="btn-close" onClick={() => setShowAddSchool(false)} />
              </div>
              <div className="modal-body">
                <p className="small text-muted mb-3">
                  Pick a US public school from the directory (no free-typed names). First load per state
                  fetches the full regional list.
                </p>
                <SchoolDirectoryPicker
                  idPrefix="add-school"
                  value={newSchoolPick}
                  onChange={setNewSchoolPick}
                />
                <div className="mt-3">
                  <label className="form-label" htmlFor="add-school-contact">
                    Contact email (optional)
                  </label>
                  <input
                    id="add-school-contact"
                    type="email"
                    className="form-control"
                    value={newSchoolContactEmail}
                    onChange={(e) => setNewSchoolContactEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setShowAddSchool(false)
                    setNewSchoolPick(null)
                    setNewSchoolContactEmail('')
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-dark" disabled={!newSchoolPick?.nces_id}>
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAddTeacher && (
        <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-scrollable">
            <form className="modal-content" onSubmit={handleAddTeacher}>
              <div className="modal-header">
                <h5 className="modal-title">Add teacher</h5>
                <button type="button" className="btn-close" onClick={() => setShowAddTeacher(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-2">
                  <label className="form-label">School</label>
                  <select
                    className="form-select"
                    required
                    value={newTeacher.schoolId}
                    onChange={(e) => setNewTeacher({ ...newTeacher, schoolId: e.target.value })}
                  >
                    {activeSchools.map((s) => (
                      <option key={s.school_id} value={s.school_id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="row g-2 mb-2">
                  <div className="col-6">
                    <label className="form-label">First name</label>
                    <input
                      className="form-control"
                      required
                      value={newTeacher.firstName}
                      onChange={(e) => setNewTeacher({ ...newTeacher, firstName: e.target.value })}
                    />
                  </div>
                  <div className="col-6">
                    <label className="form-label">Last name</label>
                    <input
                      className="form-control"
                      required
                      value={newTeacher.lastName}
                      onChange={(e) => setNewTeacher({ ...newTeacher, lastName: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="form-label">School email</label>
                  <input
                    type="email"
                    className="form-control"
                    required
                    placeholder="their school email"
                    value={newTeacher.email}
                    onChange={(e) => setNewTeacher({ ...newTeacher, email: e.target.value })}
                  />
                  <small className="text-muted">
                    We’ll create their Classroom login and email them credentials.
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setShowAddTeacher(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-dark" disabled={!!provisioningId}>
                  {provisioningId ? 'Saving…' : 'Save & create login'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
