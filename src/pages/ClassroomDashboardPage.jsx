import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  CLASSROOM_FEATURE_LABELS,
  CLASSROOM_FILE_TYPE_OPTIONS,
  acceptAttrForExtensions,
  createClass,
  deleteAssignmentMaterial,
  fetchAssignmentSubmissions,
  fetchClassAssignments,
  fetchClassRoster,
  fetchStudentEnrollments,
  fetchTeacherClasses,
  fetchTeachers,
  fetchSchools,
  fetchAllClasses,
  fetchSpanMaterials,
  createSpanMaterial,
  deactivateSpanMaterial,
  isSpanExec,
  getClassroomSessionRole,
  getSubmissionFileUrl,
  gradeSubmission,
  insertAssignment,
  removeSubmissionFile,
  updateAssignment,
  updateClassFeatures,
  uploadAssignmentMaterial,
  uploadSubmissionFile,
  upsertSubmission,
  validateSubmissionFile,
} from '../lib/classroom'
import ClassroomLegiscanPanel from './ClassroomLegiscanPanel'
import ClassroomPolicyToolkit from './ClassroomPolicyToolkit'
import './ClassroomDashboardPage.css'

const EMPTY_ASSIGNMENT_FORM = {
  title: '',
  instructions: '',
  dueAt: '',
  allowFileUpload: true,
  requireFile: false,
  allowedExtensions: CLASSROOM_FILE_TYPE_OPTIONS.map((o) => o.ext),
  materialFiles: [],
}

function assignmentToForm(a) {
  return {
    title: a.title || '',
    instructions: a.instructions || '',
    dueAt: a.due_at || '',
    allowFileUpload: a.allow_file_upload !== false,
    requireFile: !!a.require_file,
    allowedExtensions: a.allowed_extensions?.length
      ? [...a.allowed_extensions]
      : CLASSROOM_FILE_TYPE_OPTIONS.map((o) => o.ext),
    materialFiles: [],
  }
}

function buildAssignmentPatch(form) {
  const allExts = CLASSROOM_FILE_TYPE_OPTIONS.map((o) => o.ext)
  const selected = form.allowedExtensions
  const allowed =
    form.allowFileUpload && selected.length
      ? selected.length === allExts.length && allExts.every((e) => selected.includes(e))
        ? null
        : selected
      : null
  return {
    title: form.title.trim(),
    instructions: form.instructions.trim() || null,
    due_at: form.dueAt || null,
    allow_file_upload: form.allowFileUpload,
    require_file: form.allowFileUpload && form.requireFile,
    allowed_extensions: form.allowFileUpload ? allowed : null,
  }
}

function FeatureToggles({ features, onChange }) {
  return (
    <div className="d-flex flex-wrap gap-2">
      {Object.entries(CLASSROOM_FEATURE_LABELS).map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`btn btn-sm ${features?.[key] ? 'btn-dark' : 'btn-outline-secondary'}`}
          onClick={() => onChange({ ...features, [key]: !features?.[key] })}
        >
          {features?.[key] && <i className="bi bi-check-lg me-1" />}
          {label}
        </button>
      ))}
    </div>
  )
}

/** SPAN-curated materials (read-only for teachers & students). */
function SpanLibraryList() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        setItems(await fetchSpanMaterials())
      } catch (err) {
        setError(err.message || 'Could not load SPAN materials.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div className="card shadow-sm mt-4">
      <div className="card-header bg-white">
        <h5 className="mb-0">SPAN materials</h5>
        <small className="text-muted">Shared by SPAN for every Classroom class.</small>
      </div>
      <div className="card-body">
        {error && <div className="alert alert-danger py-2">{error}</div>}
        {loading ? (
          <div className="spinner-border spinner-border-sm text-secondary" role="status" />
        ) : items.length === 0 ? (
          <p className="text-muted mb-0">No SPAN materials yet.</p>
        ) : (
          <ul className="list-unstyled mb-0">
            {items.map((m) => (
              <li key={m.material_id} className="border-bottom py-2">
                <div className="fw-semibold">{m.title}</div>
                {m.description && <div className="small text-muted">{m.description}</div>}
                <div className="small">
                  {m.file_path && (
                    <SubmissionFileLink filePath={m.file_path} fileName={m.file_name} />
                  )}
                  {m.link_url && (
                    <a href={m.link_url} target="_blank" rel="noopener noreferrer">
                      <i className="bi bi-box-arrow-up-right me-1" />
                      Open link
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function toggleId(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
}

/** Exec: manage SPAN library items (add file/link, choose audience, soft-remove). */
function SpanLibraryManager() {
  const [items, setItems] = useState([])
  const [schools, setSchools] = useState([])
  const [classes, setClasses] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ title: '', description: '', linkUrl: '' })
  const [audience, setAudience] = useState('all')
  const [schoolIds, setSchoolIds] = useState([])
  const [classIds, setClassIds] = useState([])
  const [file, setFile] = useState(null)
  const [fileInputKey, setFileInputKey] = useState(0)

  const load = useCallback(async () => {
    setItems(await fetchSpanMaterials())
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const [materials, schoolRows, classRows] = await Promise.all([
          fetchSpanMaterials(),
          fetchSchools(),
          fetchAllClasses(),
        ])
        setItems(materials)
        setSchools(schoolRows.filter((s) => s.active !== false))
        setClasses(classRows.filter((c) => !c.archived && !c.classroom_teachers?.is_test))
      } catch (err) {
        setError(err.message || 'Could not load SPAN materials.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const schoolById = useMemo(() => new Map(schools.map((s) => [s.school_id, s])), [schools])
  const classById = useMemo(() => new Map(classes.map((c) => [c.class_id, c])), [classes])

  function audienceLabel(m) {
    const targets = m.classroom_span_material_targets || []
    if (m.audience === 'schools') {
      const names = targets
        .map((t) => schoolById.get(t.school_id)?.name)
        .filter(Boolean)
      return `Schools: ${names.join(', ') || '—'}`
    }
    if (m.audience === 'classes') {
      const names = targets
        .map((t) => classById.get(t.class_id)?.name)
        .filter(Boolean)
      return `Classes: ${names.join(', ') || '—'}`
    }
    return 'All teachers & students'
  }

  async function handleAdd(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await createSpanMaterial({
        title: form.title,
        description: form.description,
        linkUrl: form.linkUrl,
        file,
        audience,
        schoolIds,
        classIds,
      })
      setForm({ title: '', description: '', linkUrl: '' })
      setAudience('all')
      setSchoolIds([])
      setClassIds([])
      setFile(null)
      setFileInputKey((k) => k + 1)
      setMessage('Added to SPAN materials.')
      await load()
    } catch (err) {
      setError(err.message || 'Could not add material.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(item) {
    if (!window.confirm(`Remove “${item.title}” from SPAN materials for all classes?`)) return
    setError('')
    setMessage('')
    try {
      await deactivateSpanMaterial(item.material_id)
      setMessage('Removed.')
      await load()
    } catch (err) {
      setError(err.message || 'Could not remove material.')
    }
  }

  return (
    <div className="card shadow-sm">
      <div className="card-header bg-white">
        <h5 className="mb-0">SPAN materials</h5>
        <small className="text-muted">
          Added here, they appear for every teacher and student in SPAN Classroom.
        </small>
      </div>
      <div className="card-body">
        {error && <div className="alert alert-danger py-2">{error}</div>}
        {message && <div className="alert alert-success py-2">{message}</div>}

        <form className="border rounded p-3 mb-3 bg-light" onSubmit={handleAdd}>
          <div className="mb-2">
            <label className="form-label" htmlFor="span-mat-title">Title</label>
            <input
              id="span-mat-title"
              className="form-control"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="mb-2">
            <label className="form-label" htmlFor="span-mat-desc">Description (optional)</label>
            <input
              id="span-mat-desc"
              className="form-control"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <fieldset className="mb-2">
            <legend className="form-label fs-6 mb-1">Who sees it</legend>
            <div className="d-flex flex-wrap gap-3 mb-2">
              {[
                { value: 'all', label: 'Everyone' },
                { value: 'schools', label: 'Specific schools' },
                { value: 'classes', label: 'Specific classes' },
              ].map((opt) => (
                <div className="form-check" key={opt.value}>
                  <input
                    className="form-check-input"
                    type="radio"
                    name="span-mat-audience"
                    id={`span-mat-aud-${opt.value}`}
                    checked={audience === opt.value}
                    onChange={() => setAudience(opt.value)}
                  />
                  <label className="form-check-label" htmlFor={`span-mat-aud-${opt.value}`}>
                    {opt.label}
                  </label>
                </div>
              ))}
            </div>

            {audience === 'schools' && (
              <div className="border rounded bg-white p-2 classroom-scroll" style={{ maxHeight: 220, overflowY: 'auto' }}>
                {schools.length === 0 ? (
                  <div className="small text-muted">No active schools yet.</div>
                ) : (
                  schools.map((s) => (
                    <div className="form-check" key={s.school_id}>
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id={`span-mat-school-${s.school_id}`}
                        checked={schoolIds.includes(s.school_id)}
                        onChange={() => setSchoolIds((prev) => toggleId(prev, s.school_id))}
                      />
                      <label className="form-check-label" htmlFor={`span-mat-school-${s.school_id}`}>
                        {s.name}
                        {s.city || s.state ? (
                          <span className="text-muted small"> · {[s.city, s.state].filter(Boolean).join(', ')}</span>
                        ) : null}
                      </label>
                    </div>
                  ))
                )}
              </div>
            )}

            {audience === 'classes' && (
              <div className="border rounded bg-white p-2 classroom-scroll" style={{ maxHeight: 260, overflowY: 'auto' }}>
                {classes.length === 0 ? (
                  <div className="small text-muted">No active classes yet.</div>
                ) : (
                  classes.map((c) => (
                    <div className="form-check" key={c.class_id}>
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id={`span-mat-class-${c.class_id}`}
                        checked={classIds.includes(c.class_id)}
                        onChange={() => setClassIds((prev) => toggleId(prev, c.class_id))}
                      />
                      <label className="form-check-label" htmlFor={`span-mat-class-${c.class_id}`}>
                        {c.name}
                        <span className="text-muted small">
                          {' '}· {c.classroom_schools?.name || 'No school'} · {c.classroom_teachers
                            ? `${c.classroom_teachers.first_name} ${c.classroom_teachers.last_name}`
                            : 'No teacher'}
                        </span>
                      </label>
                    </div>
                  ))
                )}
              </div>
            )}
          </fieldset>

          <div className="row g-2 mb-2">
            <div className="col-md-6">
              <label className="form-label" htmlFor="span-mat-file">File</label>
              <input
                key={fileInputKey}
                id="span-mat-file"
                type="file"
                className="form-control"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="col-md-6">
              <label className="form-label" htmlFor="span-mat-link">Or link (https://)</label>
              <input
                id="span-mat-link"
                type="url"
                className="form-control"
                placeholder="https://spanationwide.org/…"
                value={form.linkUrl}
                onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-dark btn-sm" disabled={busy}>
            {busy ? 'Adding…' : 'Add to SPAN materials'}
          </button>
        </form>

        {loading ? (
          <div className="spinner-border spinner-border-sm text-secondary" role="status" />
        ) : items.length === 0 ? (
          <p className="text-muted mb-0">No SPAN materials yet.</p>
        ) : (
          <ul className="list-unstyled mb-0">
            {items.map((m) => (
              <li key={m.material_id} className="d-flex justify-content-between align-items-start border-bottom py-2 gap-2">
                <div className="min-w-0">
                  <div className="fw-semibold">{m.title}</div>
                  {m.description && <div className="small text-muted">{m.description}</div>}
                  <div className="small text-muted">{audienceLabel(m)}</div>
                  <div className="small">
                    {m.file_path && <SubmissionFileLink filePath={m.file_path} fileName={m.file_name} />}
                    {m.link_url && (
                      <a href={m.link_url} target="_blank" rel="noopener noreferrer">
                        <i className="bi bi-box-arrow-up-right me-1" />
                        Open link
                      </a>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger flex-shrink-0"
                  onClick={() => handleRemove(m)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** Exec landing: teachers to view-as + SPAN library manager. */
function ExecClassroomConsole() {
  const [teachers, setTeachers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const rows = await fetchTeachers()
        setTeachers(rows.filter((t) => t.active !== false && !t.is_test))
      } catch (err) {
        setError(err.message || 'Could not load teachers.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="row g-4">
        <div className="col-lg-5">
          <div className="card shadow-sm">
            <div className="card-header bg-white">
              <h5 className="mb-0">Teacher workspaces</h5>
              <small className="text-muted">Open a teacher’s classes and assignments as them.</small>
            </div>
            <div className="list-group list-group-flush classroom-scroll">
              {loading ? (
                <div className="p-3">
                  <div className="spinner-border spinner-border-sm text-secondary" role="status" />
                </div>
              ) : teachers.length === 0 ? (
                <div className="p-3 text-muted small">No active teachers yet. Add one from the dashboard Classroom section.</div>
              ) : (
                teachers.map((t) => (
                  <a
                    key={t.teacher_id}
                    href={`/classroom/dashboard.html?viewAsTeacher=${encodeURIComponent(t.teacher_id)}`}
                    className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                  >
                    <span>
                      <strong>{t.first_name} {t.last_name}</strong>
                      <span className="d-block small text-muted">
                        {t.classroom_schools?.name || 'No school'} · {t.email}
                      </span>
                    </span>
                    <span className="btn btn-sm btn-outline-dark">View as</span>
                  </a>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="col-lg-7">
          <SpanLibraryManager />
        </div>
      </div>
    </>
  )
}

function SubmissionFileLink({ filePath, fileName }) {
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!filePath) return null

  async function openFile() {
    setBusy(true)
    setErr('')
    try {
      const signed = await getSubmissionFileUrl(filePath)
      if (!signed) throw new Error('Could not open file')
      setUrl(signed)
      window.open(signed, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setErr(e.message || 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-1">
      <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={openFile} disabled={busy}>
        <i className="bi bi-paperclip me-1" />
        {busy ? 'Opening…' : (fileName || 'Attached file')}
      </button>
      {err && <div className="text-danger small">{err}</div>}
      {url && (
        <a className="visually-hidden" href={url}>
          file
        </a>
      )}
    </div>
  )
}

function TeacherDashboard({ profile }) {
  const [classes, setClasses] = useState([])
  const [selectedClassId, setSelectedClassId] = useState('')
  const [roster, setRoster] = useState([])
  const [assignments, setAssignments] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [gradeDrafts, setGradeDrafts] = useState({})
  const [savingGradeId, setSavingGradeId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [newClassName, setNewClassName] = useState('')
  const [newClassTerm, setNewClassTerm] = useState('Fall 2026')
  const [showNewClass, setShowNewClass] = useState(false)
  const [showNewAssignment, setShowNewAssignment] = useState(false)
  const [editingAssignmentId, setEditingAssignmentId] = useState(null)
  const [newAssignment, setNewAssignment] = useState(EMPTY_ASSIGNMENT_FORM)
  const [creatingAssignment, setCreatingAssignment] = useState(false)

  const selectedClass = classes.find((c) => c.class_id === selectedClassId) || classes[0]

  const loadClasses = useCallback(async () => {
    const rows = await fetchTeacherClasses(profile.teacher_id)
    setClasses(rows)
    if (rows.length && !rows.some((c) => c.class_id === selectedClassId)) {
      setSelectedClassId(rows[0].class_id)
    }
  }, [selectedClassId])

  const loadClassDetail = useCallback(async (classId) => {
    if (!classId) return
    const [rosterRows, assignmentRows] = await Promise.all([
      fetchClassRoster(classId),
      fetchClassAssignments(classId),
    ])
    setRoster(rosterRows)
    setAssignments(assignmentRows)
    const subs = await fetchAssignmentSubmissions(assignmentRows.map((a) => a.assignment_id))
    setSubmissions(subs)
    setGradeDrafts(
      Object.fromEntries(
        subs.map((sub) => [
          sub.submission_id,
          { grade: sub.grade || '', feedback: sub.feedback || '' },
        ]),
      ),
    )
  }, [])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        await loadClasses()
      } catch (err) {
        setError(err.message || 'Failed to load classes.')
      } finally {
        setLoading(false)
      }
    })()
  }, [loadClasses])

  useEffect(() => {
    if (selectedClass?.class_id) {
      loadClassDetail(selectedClass.class_id).catch((err) => setError(err.message))
    }
  }, [selectedClass?.class_id, loadClassDetail])

  async function handleSaveGrade(sub) {
    setSavingGradeId(sub.submission_id)
    setError('')
    setMessage('')
    try {
      const draft = gradeDrafts[sub.submission_id] || { grade: '', feedback: '' }
      const updated = await gradeSubmission(sub.submission_id, draft.grade, draft.feedback)
      setSubmissions((prev) =>
        prev.map((s) => (s.submission_id === sub.submission_id ? { ...s, ...updated } : s)),
      )
      setMessage(`Saved feedback for ${sub.classroom_students?.first_name || 'student'}.`)
    } catch (err) {
      setError(err.message || 'Could not save grade.')
    } finally {
      setSavingGradeId(null)
    }
  }

  async function handleCreateClass(e) {
    e.preventDefault()
    try {
      const row = await createClass(newClassName, newClassTerm)
      setShowNewClass(false)
      setNewClassName('')
      await loadClasses()
      setSelectedClassId(row.class_id)
    } catch (err) {
      setError(err.message || 'Could not create class.')
    }
  }

  async function handleCreateAssignment(e) {
    e.preventDefault()
    if (!selectedClass) return
    setCreatingAssignment(true)
    setError('')
    try {
      const patch = buildAssignmentPatch(newAssignment)
      if (editingAssignmentId) {
        await updateAssignment(editingAssignmentId, patch)
        for (const file of newAssignment.materialFiles || []) {
          await uploadAssignmentMaterial({
            classId: selectedClass.class_id,
            assignmentId: editingAssignmentId,
            file,
          })
        }
        setMessage('Assignment updated.')
      } else {
        const row = await insertAssignment({
          class_id: selectedClass.class_id,
          ...patch,
        })
        for (const file of newAssignment.materialFiles || []) {
          await uploadAssignmentMaterial({
            classId: selectedClass.class_id,
            assignmentId: row.assignment_id,
            file,
          })
        }
        setMessage('Assignment created.')
      }

      setShowNewAssignment(false)
      setEditingAssignmentId(null)
      setNewAssignment(EMPTY_ASSIGNMENT_FORM)
      await loadClassDetail(selectedClass.class_id)
    } catch (err) {
      setError(err.message || 'Could not save assignment.')
    } finally {
      setCreatingAssignment(false)
    }
  }

  function openCreateAssignment() {
    setEditingAssignmentId(null)
    setNewAssignment(EMPTY_ASSIGNMENT_FORM)
    setShowNewAssignment(true)
  }

  function openEditAssignment(a) {
    setEditingAssignmentId(a.assignment_id)
    setNewAssignment(assignmentToForm(a))
    setShowNewAssignment(true)
  }

  function closeAssignmentModal() {
    setShowNewAssignment(false)
    setEditingAssignmentId(null)
    setNewAssignment(EMPTY_ASSIGNMENT_FORM)
  }

  async function handleAddMaterials(assignmentId, fileList) {
    if (!selectedClass || !fileList?.length) return
    setError('')
    try {
      for (const file of Array.from(fileList)) {
        await uploadAssignmentMaterial({
          classId: selectedClass.class_id,
          assignmentId,
          file,
        })
      }
      await loadClassDetail(selectedClass.class_id)
      setMessage('Materials uploaded.')
    } catch (err) {
      setError(err.message || 'Could not upload materials.')
    }
  }

  async function handleDeleteMaterial(material) {
    setError('')
    try {
      await deleteAssignmentMaterial(material)
      await loadClassDetail(selectedClass.class_id)
    } catch (err) {
      setError(err.message || 'Could not remove material.')
    }
  }

  function toggleAllowedExt(ext) {
    setNewAssignment((prev) => {
      const has = prev.allowedExtensions.includes(ext)
      const next = has
        ? prev.allowedExtensions.filter((e) => e !== ext)
        : [...prev.allowedExtensions, ext]
      return { ...prev, allowedExtensions: next }
    })
  }

  async function handleFeatureChange(features) {
    if (!selectedClass) return
    try {
      await updateClassFeatures(selectedClass.class_id, features)
      await loadClasses()
    } catch (err) {
      setError(err.message || 'Could not update features.')
    }
  }

  if (loading) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-secondary" role="status" />
      </div>
    )
  }

  return (
    <>
      {error && <div className="alert alert-danger">{error}</div>}
      {message && <div className="alert alert-success py-2">{message}</div>}
      {profile.execView ? (
        <div className="alert alert-warning py-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
          <span>
            Exec view: working in <strong>{profile.first_name} {profile.last_name}</strong>’s workspace.
          </span>
          <a href="/classroom/dashboard.html" className="btn btn-sm btn-outline-dark">
            Back to exec console
          </a>
        </div>
      ) : (
        <p className="text-muted">
          Signed in as <strong>{profile.first_name} {profile.last_name}</strong> ({profile.email})
        </p>
      )}

      <div className="row g-4">
        <div className="col-lg-4">
          <div className="card shadow-sm">
            <div className="card-header bg-white d-flex justify-content-between align-items-center">
              <h5 className="mb-0">{profile.execView ? 'Classes' : 'My classes'}</h5>
              {!profile.execView && (
                <button
                  type="button"
                  className="btn btn-sm btn-dark"
                  onClick={() => setShowNewClass(true)}
                  aria-label="Create class"
                >
                  <i className="bi bi-plus-lg" aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="list-group list-group-flush classroom-scroll">
              {classes.length === 0 ? (
                <div className="p-3 text-muted small">Create your first class.</div>
              ) : (
                classes.map((c) => (
                  <button
                    key={c.class_id}
                    type="button"
                    className={`list-group-item list-group-item-action ${
                      selectedClass?.class_id === c.class_id ? 'active' : ''
                    }`}
                    onClick={() => setSelectedClassId(c.class_id)}
                  >
                    <div className="fw-semibold">{c.name}</div>
                    <div className={`small ${selectedClass?.class_id === c.class_id ? 'text-white-50' : 'text-muted'}`}>
                      {c.term}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-8">
          {selectedClass ? (
            <>
              <div className="card shadow-sm mb-4">
                <div className="card-body">
                  <div className="d-flex flex-wrap justify-content-between gap-2">
                    <div>
                      <h4 className="mb-1">{selectedClass.name}</h4>
                      <p className="text-muted mb-0">{selectedClass.term}</p>
                    </div>
                    <div className="text-end">
                      <div className="small text-muted">Join code</div>
                      <code className="fs-5">{selectedClass.join_code}</code>
                      <div className="small mt-1">
                        <a href={`/classroom/join.html?code=${encodeURIComponent(selectedClass.join_code)}`}>
                          Student join link
                        </a>
                      </div>
                    </div>
                  </div>
                  <hr />
                  <div className="small fw-semibold mb-2">Enabled features</div>
                  <FeatureToggles features={selectedClass.features} onChange={handleFeatureChange} />
                </div>
              </div>

              <div className="card shadow-sm mb-4">
                <div className="card-header bg-white">
                  <h5 className="mb-0">Roster ({roster.length})</h5>
                </div>
                <div className="card-body p-0">
                  {roster.length === 0 ? (
                    <p className="text-muted p-3 mb-0">Share the join code with students.</p>
                  ) : (
                    <div className="table-responsive classroom-scroll">
                      <table className="table table-sm mb-0">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Joined</th>
                          </tr>
                        </thead>
                        <tbody>
                          {roster.map((row) => {
                            const s = row.classroom_students
                            if (!s) return null
                            return (
                              <tr key={s.student_id}>
                                <td>
                                  {s.first_name} {s.last_name}
                                </td>
                                <td className="small">{s.email}</td>
                                <td className="small">{s.phone}</td>
                                <td className="small">{row.joined_at?.slice(0, 10)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="card shadow-sm">
                <div className="card-header bg-white d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">Assignments</h5>
                  <button type="button" className="btn btn-sm btn-dark" onClick={openCreateAssignment}>
                    New assignment
                  </button>
                </div>
                <div className="card-body classroom-scroll-tall">
                  {assignments.length === 0 ? (
                    <p className="text-muted mb-0">No assignments yet.</p>
                  ) : (
                    assignments.map((a) => {
                      const subs = submissions.filter((s) => s.assignment_id === a.assignment_id)
                      const gradedCount = subs.filter((s) => s.grade || s.feedback).length
                      return (
                        <div key={a.assignment_id} className="border rounded p-3 mb-3">
                          <div className="d-flex justify-content-between flex-wrap gap-2">
                            <strong>{a.title}</strong>
                            <div className="d-flex flex-wrap gap-2 align-items-center">
                              {a.due_at && <span className="badge bg-light text-dark border">Due {a.due_at}</span>}
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                onClick={() => openEditAssignment(a)}
                              >
                                Edit
                              </button>
                            </div>
                          </div>
                          <p className="small text-muted mb-2 classroom-submission-body">{a.instructions}</p>
                          <div className="small text-muted mb-2">
                            {a.allow_file_upload === false
                              ? 'Text only'
                              : a.require_file
                                ? 'File required'
                                : a.allowed_extensions?.length
                                  ? `Accepts: ${a.allowed_extensions.map((e) => `.${e}`).join(', ')}`
                                  : 'Accepts files (any supported type)'}
                            {a.require_file && a.allowed_extensions?.length
                              ? ` · ${a.allowed_extensions.map((e) => `.${e}`).join(', ')}`
                              : a.require_file
                                ? ' · any supported type'
                                : ''}
                          </div>
                          <div className="mb-2">
                            <div className="small fw-semibold mb-1">Teacher materials</div>
                            {(a.classroom_assignment_materials || []).length === 0 ? (
                              <div className="small text-muted mb-1">No materials yet.</div>
                            ) : (
                              (a.classroom_assignment_materials || []).map((m) => (
                                <div key={m.material_id} className="d-flex align-items-center gap-2 small mb-1">
                                  <SubmissionFileLink filePath={m.file_path} fileName={m.file_name} />
                                  <button
                                    type="button"
                                    className="btn btn-link btn-sm text-danger p-0"
                                    onClick={() => handleDeleteMaterial(m)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))
                            )}
                            <label className="btn btn-sm btn-outline-secondary mt-1 mb-0">
                              Add materials
                              <input
                                type="file"
                                className="d-none"
                                multiple
                                onChange={(e) => {
                                  handleAddMaterials(a.assignment_id, e.target.files)
                                  e.target.value = ''
                                }}
                              />
                            </label>
                          </div>
                          <div className="small mb-2">
                            {subs.length} submission(s)
                            {subs.length > 0 && (
                              <span className="text-muted"> · {gradedCount} graded</span>
                            )}
                          </div>
                          {subs.map((sub) => {
                            const draft = gradeDrafts[sub.submission_id] || {
                              grade: sub.grade || '',
                              feedback: sub.feedback || '',
                            }
                            return (
                              <div key={sub.submission_id} className="bg-light rounded p-3 small mb-2">
                                <div className="d-flex flex-wrap justify-content-between gap-2 mb-1">
                                  <strong>
                                    {sub.classroom_students?.first_name} {sub.classroom_students?.last_name}
                                  </strong>
                                  <span className="text-muted">
                                    {sub.submitted_at
                                      ? new Date(sub.submitted_at).toLocaleString()
                                      : ''}
                                  </span>
                                </div>
                                {sub.body && (
                                  <div className="classroom-submission-body mb-1">
                                    <span className="text-muted">
                                      {a.require_file ? 'Comments: ' : ''}
                                    </span>
                                    {sub.body}
                                  </div>
                                )}
                                <SubmissionFileLink filePath={sub.file_path} fileName={sub.file_name} />
                                <div className="row g-2 mt-2">
                                  <div className="col-md-3">
                                    <label className="form-label mb-1">Grade</label>
                                    <input
                                      className="form-control form-control-sm"
                                      placeholder="e.g. A / 92 / Complete"
                                      value={draft.grade}
                                      onChange={(e) =>
                                        setGradeDrafts((prev) => ({
                                          ...prev,
                                          [sub.submission_id]: { ...draft, grade: e.target.value },
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="col-md-9">
                                    <label className="form-label mb-1">Feedback</label>
                                    <textarea
                                      className="form-control form-control-sm"
                                      rows={2}
                                      placeholder="Comments for the student…"
                                      value={draft.feedback}
                                      onChange={(e) =>
                                        setGradeDrafts((prev) => ({
                                          ...prev,
                                          [sub.submission_id]: { ...draft, feedback: e.target.value },
                                        }))
                                      }
                                    />
                                  </div>
                                </div>
                                <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-dark"
                                    disabled={savingGradeId === sub.submission_id}
                                    onClick={() => handleSaveGrade(sub)}
                                  >
                                    {savingGradeId === sub.submission_id ? 'Saving…' : 'Save grade'}
                                  </button>
                                  {sub.graded_at && (
                                    <span className="text-muted">
                                      Last graded {new Date(sub.graded_at).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="text-muted">Create a class to get started.</p>
          )}
        </div>
      </div>

      {showNewClass && (
        <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <form className="modal-content" onSubmit={handleCreateClass}>
              <div className="modal-header">
                <h5 className="modal-title">New class</h5>
                <button type="button" className="btn-close" onClick={() => setShowNewClass(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-2">
                  <label className="form-label">Class name</label>
                  <input
                    className="form-control"
                    required
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">Term</label>
                  <input
                    className="form-control"
                    value={newClassTerm}
                    onChange={(e) => setNewClassTerm(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setShowNewClass(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-dark">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewAssignment && (
        <div className="modal fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-scrollable">
            <form className="modal-content" onSubmit={handleCreateAssignment}>
              <div className="modal-header">
                <h5 className="modal-title">{editingAssignmentId ? 'Edit assignment' : 'New assignment'}</h5>
                <button type="button" className="btn-close" onClick={closeAssignmentModal} />
              </div>
              <div className="modal-body">
                <div className="mb-2">
                  <label className="form-label">Title</label>
                  <input
                    className="form-control"
                    required
                    value={newAssignment.title}
                    onChange={(e) => setNewAssignment({ ...newAssignment, title: e.target.value })}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label">Instructions</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={newAssignment.instructions}
                    onChange={(e) => setNewAssignment({ ...newAssignment, instructions: e.target.value })}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">Due date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={newAssignment.dueAt}
                    onChange={(e) => setNewAssignment({ ...newAssignment, dueAt: e.target.value })}
                  />
                </div>

                <div className="border rounded p-3 mb-3">
                  <div className="form-check mb-2">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="allow-file-upload"
                      checked={newAssignment.allowFileUpload}
                      onChange={(e) =>
                        setNewAssignment({
                          ...newAssignment,
                          allowFileUpload: e.target.checked,
                          requireFile: e.target.checked ? newAssignment.requireFile : false,
                        })
                      }
                    />
                    <label className="form-check-label" htmlFor="allow-file-upload">
                      Allow file submissions
                    </label>
                  </div>
                  {newAssignment.allowFileUpload && (
                    <>
                      <div className="form-check mb-2">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="require-file"
                          checked={newAssignment.requireFile}
                          onChange={(e) =>
                            setNewAssignment({ ...newAssignment, requireFile: e.target.checked })
                          }
                        />
                        <label className="form-check-label" htmlFor="require-file">
                          Require a file (students upload a file; optional comments only)
                        </label>
                      </div>
                      <div className="small fw-semibold mb-1">Accepted file types</div>
                      <div className="d-flex flex-wrap gap-2 mb-1">
                        {CLASSROOM_FILE_TYPE_OPTIONS.map((opt) => (
                          <label key={opt.ext} className="form-check form-check-inline m-0">
                            <input
                              className="form-check-input me-1"
                              type="checkbox"
                              checked={newAssignment.allowedExtensions.includes(opt.ext)}
                              onChange={() => toggleAllowedExt(opt.ext)}
                            />
                            <span className="small">{opt.label}</span>
                          </label>
                        ))}
                      </div>
                      <div className="small text-muted">Leave several checked, or all for any supported type.</div>
                    </>
                  )}
                </div>

                <div className="mb-0">
                  <label className="form-label">
                    {editingAssignmentId ? 'Add more context materials (optional)' : 'Context materials (optional)'}
                  </label>
                  <input
                    type="file"
                    className="form-control"
                    multiple
                    onChange={(e) =>
                      setNewAssignment({
                        ...newAssignment,
                        materialFiles: Array.from(e.target.files || []),
                      })
                    }
                  />
                  <small className="text-muted">
                    Rubrics, readings, templates — students can download these.
                    {editingAssignmentId ? ' Existing materials stay unless you remove them on the assignment card.' : ''}
                  </small>
                  {newAssignment.materialFiles?.length > 0 && (
                    <ul className="small mb-0 mt-1">
                      {newAssignment.materialFiles.map((f) => (
                        <li key={f.name + f.size}>{f.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={closeAssignmentModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-dark"
                  disabled={creatingAssignment || (newAssignment.allowFileUpload && !newAssignment.allowedExtensions.length)}
                >
                  {creatingAssignment
                    ? 'Saving…'
                    : editingAssignmentId
                      ? 'Save changes'
                      : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <SpanLibraryList />
    </>
  )
}

function StudentDashboard({ profile }) {
  const [enrollments, setEnrollments] = useState([])
  const [assignments, setAssignments] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [drafts, setDrafts] = useState({})
  const [files, setFiles] = useState({})
  const [editingSubmissionId, setEditingSubmissionId] = useState(null)
  const [submittingId, setSubmittingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedClassId, setSelectedClassId] = useState('')

  const load = useCallback(async () => {
    const enrollRows = await fetchStudentEnrollments()
    setEnrollments(enrollRows)
    const classIds = enrollRows.map((e) => e.class_id)
    if (classIds.length === 0) {
      setAssignments([])
      setSubmissions([])
      return
    }
    if (!selectedClassId || !classIds.includes(selectedClassId)) {
      setSelectedClassId(enrollRows[0].class_id)
    }
    const activeId = selectedClassId && classIds.includes(selectedClassId) ? selectedClassId : enrollRows[0].class_id
    const assignmentRows = await fetchClassAssignments(activeId)
    setAssignments(assignmentRows)
    const subs = await fetchAssignmentSubmissions(assignmentRows.map((a) => a.assignment_id))
    setSubmissions(subs.filter((s) => s.student_id === profile.student_id))
  }, [profile.student_id, selectedClassId])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        await load()
      } catch (err) {
        setError(err.message || 'Failed to load.')
      } finally {
        setLoading(false)
      }
    })()
  }, [load])

  async function handleSubmit(assignmentId, existing = null) {
    const assignment = assignments.find((a) => a.assignment_id === assignmentId)
    const body = (drafts[assignmentId] || '').trim()
    const file = files[assignmentId] || null
    const allowFileUpload = assignment?.allow_file_upload !== false
    const requireFile = !!assignment?.require_file
    const allowedExtensions = assignment?.allowed_extensions || null
    const keepingExistingFile = !file && !!existing?.file_path

    if (file) {
      const typeError = validateSubmissionFile(file, { allowFileUpload, allowedExtensions })
      if (typeError) {
        setError(typeError)
        return
      }
    }
    if (!allowFileUpload && file) {
      setError('This assignment does not accept file uploads.')
      return
    }

    if (requireFile && allowFileUpload) {
      if (!file && !keepingExistingFile) {
        setError('This assignment requires a file attachment.')
        return
      }
    } else if (!allowFileUpload) {
      if (!body) {
        setError('Add a written response before submitting.')
        return
      }
    } else if (!body && !file && !keepingExistingFile) {
      setError('Add a written response and/or attach a file before submitting.')
      return
    }

    setSubmittingId(assignmentId)
    setError('')
    try {
      let filePath = existing?.file_path || null
      let fileName = existing?.file_name || null
      if (file && allowFileUpload) {
        const uploaded = await uploadSubmissionFile({
          classId: selectedClassId || enrollments[0]?.class_id,
          assignmentId,
          studentId: profile.student_id,
          file,
          allowFileUpload,
          allowedExtensions,
        })
        if (existing?.file_path && existing.file_path !== uploaded.path) {
          try {
            await removeSubmissionFile(existing.file_path)
          } catch {
            // Non-fatal if old file cleanup fails
          }
        }
        filePath = uploaded.path
        fileName = uploaded.fileName
      }

      await upsertSubmission({
        assignment_id: assignmentId,
        student_id: profile.student_id,
        body: body || null,
        file_path: allowFileUpload ? filePath : null,
        file_name: allowFileUpload ? fileName : null,
        submitted_at: new Date().toISOString(),
      })
      setDrafts((prev) => ({ ...prev, [assignmentId]: '' }))
      setFiles((prev) => ({ ...prev, [assignmentId]: null }))
      setEditingSubmissionId(null)
      await load()
    } catch (err) {
      setError(err.message || 'Submit failed.')
    } finally {
      setSubmittingId(null)
    }
  }

  function startEditSubmission(assignment, existing) {
    setEditingSubmissionId(assignment.assignment_id)
    setDrafts((prev) => ({ ...prev, [assignment.assignment_id]: existing.body || '' }))
    setFiles((prev) => ({ ...prev, [assignment.assignment_id]: null }))
  }

  function cancelEditSubmission(assignmentId) {
    setEditingSubmissionId(null)
    setDrafts((prev) => ({ ...prev, [assignmentId]: '' }))
    setFiles((prev) => ({ ...prev, [assignmentId]: null }))
  }

  const activeEnrollment = enrollments.find((e) => e.class_id === selectedClassId) || enrollments[0]
  const activeClass = activeEnrollment?.classroom_classes
  const features = activeClass?.features || {}

  if (loading) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-secondary" role="status" />
      </div>
    )
  }

  if (enrollments.length === 0) {
    return (
      <div className="alert alert-info">
        You are not enrolled in a class yet.{' '}
        <a href="/classroom/join.html">Join with a class code</a>.
      </div>
    )
  }

  return (
    <>
      {error && <div className="alert alert-danger">{error}</div>}
      <p className="text-muted">
        Signed in as <strong>{profile.first_name} {profile.last_name}</strong>
      </p>

      {enrollments.length > 1 && (
        <div className="mb-3">
          <label className="form-label small">Class</label>
          <select
            className="form-select form-select-sm"
            style={{ maxWidth: 360 }}
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
          >
            {enrollments.map((e) => (
              <option key={e.class_id} value={e.class_id}>
                {e.classroom_classes?.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="card shadow-sm mb-4">
        <div className="card-body">
          <h4 className="mb-1">{activeClass?.name}</h4>
          <p className="text-muted mb-0">{activeClass?.term}</p>
        </div>
      </div>

      {features.assignments !== false && (
        <div className="card shadow-sm mb-4">
          <div className="card-header bg-white">
            <h5 className="mb-0">Assignments</h5>
          </div>
          <div className="card-body classroom-scroll-tall">
            {assignments.length === 0 ? (
              <p className="text-muted mb-0">No assignments yet.</p>
            ) : (
              assignments.map((a) => {
                const existing = submissions.find((s) => s.assignment_id === a.assignment_id)
                const materials = a.classroom_assignment_materials || []
                const allowFileUpload = a.allow_file_upload !== false
                const requireFile = !!a.require_file
                const isEditing = editingSubmissionId === a.assignment_id
                const showForm = !existing || isEditing

                function renderSubmitFields() {
                  return (
                    <>
                      {requireFile && allowFileUpload ? (
                        <div className="mb-2">
                          <label className="form-label small mb-1">Comments (optional)</label>
                          <textarea
                            className="form-control form-control-sm"
                            rows={2}
                            placeholder="Optional note for your teacher…"
                            value={drafts[a.assignment_id] || ''}
                            onChange={(e) =>
                              setDrafts((prev) => ({ ...prev, [a.assignment_id]: e.target.value }))
                            }
                          />
                        </div>
                      ) : (
                        <textarea
                          className="form-control form-control-sm mb-2"
                          rows={3}
                          placeholder="Your written response…"
                          value={drafts[a.assignment_id] || ''}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [a.assignment_id]: e.target.value }))
                          }
                        />
                      )}

                      {allowFileUpload ? (
                        <div className="mb-2">
                          <label className="form-label small mb-1">
                            {requireFile ? 'Attach a file (required)' : 'Attach a file (optional)'}, max 10 MB
                          </label>
                          {isEditing && existing?.file_path && !files[a.assignment_id] && (
                            <div className="small mb-1">
                              Current file: <SubmissionFileLink filePath={existing.file_path} fileName={existing.file_name} />
                              <span className="text-muted"> — choose a new file below to replace it</span>
                            </div>
                          )}
                          <input
                            type="file"
                            className="form-control form-control-sm"
                            accept={acceptAttrForExtensions(a.allowed_extensions)}
                            onChange={(e) =>
                              setFiles((prev) => ({
                                ...prev,
                                [a.assignment_id]: e.target.files?.[0] || null,
                              }))
                            }
                          />
                          <div className="small text-muted mt-1">
                            {a.allowed_extensions?.length
                              ? `Allowed: ${a.allowed_extensions.map((ext) => `.${ext}`).join(', ')}`
                              : 'Any supported classroom file type'}
                          </div>
                          {files[a.assignment_id] && (
                            <div className="small text-muted mt-1">{files[a.assignment_id].name}</div>
                          )}
                        </div>
                      ) : (
                        <div className="small text-muted mb-2">This assignment is text-only (no file upload).</div>
                      )}

                      <div className="d-flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-dark"
                          disabled={submittingId === a.assignment_id}
                          onClick={() => handleSubmit(a.assignment_id, existing)}
                        >
                          {submittingId === a.assignment_id
                            ? 'Saving…'
                            : isEditing
                              ? 'Save changes'
                              : 'Submit'}
                        </button>
                        {isEditing && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => cancelEditSubmission(a.assignment_id)}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </>
                  )
                }

                return (
                  <div key={a.assignment_id} className="border rounded p-3 mb-3">
                    <strong>{a.title}</strong>
                    {a.due_at && <span className="badge bg-light text-dark border ms-2">Due {a.due_at}</span>}
                    <p className="small text-muted mt-2 mb-2 classroom-submission-body">{a.instructions}</p>

                    {materials.length > 0 && (
                      <div className="mb-2 small">
                        <div className="fw-semibold mb-1">Materials from your teacher</div>
                        {materials.map((m) => (
                          <SubmissionFileLink key={m.material_id} filePath={m.file_path} fileName={m.file_name} />
                        ))}
                      </div>
                    )}

                    {existing && !isEditing ? (
                      <div className="small">
                        <div className="alert alert-success py-2 mb-2">
                          <div className="d-flex flex-wrap justify-content-between gap-2">
                            <span>Submitted {new Date(existing.submitted_at).toLocaleString()}</span>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-dark"
                              onClick={() => startEditSubmission(a, existing)}
                            >
                              Edit submission
                            </button>
                          </div>
                          {existing.body && (
                            <div className="mt-1 classroom-submission-body">
                              {requireFile ? <span className="text-muted">Comments: </span> : null}
                              {existing.body}
                            </div>
                          )}
                          <SubmissionFileLink filePath={existing.file_path} fileName={existing.file_name} />
                        </div>
                        {(existing.grade || existing.feedback) && (
                          <div className="border rounded p-2 bg-white">
                            <div className="fw-semibold mb-1">Teacher feedback</div>
                            {existing.grade && (
                              <div>
                                Grade: <strong>{existing.grade}</strong>
                              </div>
                            )}
                            {existing.feedback && (
                              <div className="classroom-submission-body mt-1">{existing.feedback}</div>
                            )}
                            {existing.graded_at && (
                              <div className="text-muted mt-1">
                                Graded {new Date(existing.graded_at).toLocaleString()}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      showForm && renderSubmitFields()
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      <SpanLibraryList />

      <div className="classroom-tools mt-2">
        {features.legiscan && <ClassroomLegiscanPanel />}
        {features.policy_toolkit && <ClassroomPolicyToolkit />}
      </div>
    </>
  )
}

export default function ClassroomDashboardPage() {
  const [loading, setLoading] = useState(true)
  const [roleInfo, setRoleInfo] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          window.location.href = '/login.html?mode=classroom&next=' + encodeURIComponent('/classroom/dashboard.html')
          return
        }
        const role = await getClassroomSessionRole()
        const exec = await isSpanExec()
        const viewAsTeacherId = new URLSearchParams(window.location.search).get('viewAsTeacher')

        // Exec "View as": open a teacher's workspace (RLS grants execs access to their classes).
        if (exec && viewAsTeacherId) {
          const teachers = await fetchTeachers()
          const target = teachers.find((t) => t.teacher_id === viewAsTeacherId)
          if (!target) {
            setError('That teacher was not found.')
            return
          }
          setRoleInfo({
            role: 'teacher',
            execView: true,
            teacher_id: target.teacher_id,
            first_name: target.first_name,
            last_name: target.last_name,
            email: target.email,
            school_id: target.school_id,
          })
          return
        }

        if (!role?.role) {
          if (exec) {
            setRoleInfo({ role: 'exec' })
            return
          }
          setError('No classroom account linked to this login. Ask an exec to link your teacher record, or join as a student.')
          return
        }
        setRoleInfo(role)
      } catch (err) {
        setError(err.message || 'Failed to load classroom session.')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    window.location.href = '/login.html?mode=classroom'
  }

  return (
    <main className="classroom-dashboard-page">
      <div className="container py-4 py-lg-5">
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
          <div>
            <h1 className="h3 mb-1">SPAN Classroom</h1>
            <p className="text-muted mb-0">Teacher & student workspace</p>
          </div>
          <div className="d-flex gap-2">
            <a href="/dashboard.html" className="btn btn-sm btn-outline-secondary">
              Chapter dashboard
            </a>
            <button type="button" className="btn btn-sm btn-outline-dark" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-5">
            <div className="spinner-border text-secondary" role="status" />
          </div>
        ) : error ? (
          <div className="alert alert-warning">{error}</div>
        ) : roleInfo?.role === 'exec' ? (
          <ExecClassroomConsole />
        ) : roleInfo?.role === 'teacher' ? (
          <TeacherDashboard key={roleInfo.teacher_id} profile={roleInfo} />
        ) : (
          <StudentDashboard profile={roleInfo} />
        )}
      </div>
    </main>
  )
}
