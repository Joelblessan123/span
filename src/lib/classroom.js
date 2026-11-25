import { supabase } from './supabase'

export const DEFAULT_CLASSROOM_FEATURES = {
  assignments: true,
  legiscan: true,
  policy_toolkit: true,
}

export const CLASSROOM_FEATURE_LABELS = {
  assignments: 'Assignments',
  legiscan: 'LegiScan search',
  policy_toolkit: 'Policy toolkit',
}

const SUBMISSION_BUCKET = 'classroom-submissions'
const MAX_SUBMISSION_BYTES = 10 * 1024 * 1024

/** Common LMS-style extensions teachers can allow for submissions. */
export const CLASSROOM_FILE_TYPE_OPTIONS = [
  { ext: 'pdf', label: 'PDF', accept: '.pdf,application/pdf' },
  { ext: 'doc', label: 'DOC', accept: '.doc,application/msword' },
  { ext: 'docx', label: 'DOCX', accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { ext: 'ppt', label: 'PPT', accept: '.ppt,application/vnd.ms-powerpoint' },
  { ext: 'pptx', label: 'PPTX', accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  { ext: 'txt', label: 'TXT', accept: '.txt,text/plain' },
  { ext: 'png', label: 'PNG', accept: '.png,image/png' },
  { ext: 'jpg', label: 'JPG', accept: '.jpg,.jpeg,image/jpeg' },
  { ext: 'webp', label: 'WEBP', accept: '.webp,image/webp' },
  { ext: 'gif', label: 'GIF', accept: '.gif,image/gif' },
]

export function fileExtension(fileName) {
  const parts = String(fileName || '').toLowerCase().split('.')
  if (parts.length < 2) return ''
  return parts.pop() || ''
}

export function acceptAttrForExtensions(extensions) {
  if (!extensions || !extensions.length) {
    return CLASSROOM_FILE_TYPE_OPTIONS.map((o) => o.accept).join(',')
  }
  const set = new Set(extensions.map((e) => String(e).toLowerCase().replace(/^\./, '')))
  return CLASSROOM_FILE_TYPE_OPTIONS.filter((o) => set.has(o.ext))
    .map((o) => o.accept)
    .join(',')
}

export function validateSubmissionFile(file, { allowFileUpload = true, allowedExtensions = null } = {}) {
  if (!file) return null
  if (!allowFileUpload) {
    return 'This assignment does not accept file uploads.'
  }
  if (file.size > MAX_SUBMISSION_BYTES) {
    return 'File must be 10 MB or smaller'
  }
  const ext = fileExtension(file.name)
  const normalizedExt = ext === 'jpeg' ? 'jpg' : ext
  if (allowedExtensions?.length) {
    const allowed = allowedExtensions.map((e) => {
      const x = String(e).toLowerCase().replace(/^\./, '')
      return x === 'jpeg' ? 'jpg' : x
    })
    if (!allowed.includes(normalizedExt)) {
      return `File type .${ext || '?'} is not allowed. Use: ${allowed.map((e) => `.${e}`).join(', ')}`
    }
  } else {
    const known = new Set(CLASSROOM_FILE_TYPE_OPTIONS.map((o) => o.ext))
    if (!known.has(normalizedExt)) {
      return 'Unsupported file type.'
    }
  }
  return null
}

export async function getClassroomSessionRole() {
  const { data, error } = await supabase.rpc('get_classroom_session_role')
  if (error) throw error
  return data || {}
}

export async function validateJoinCode(code) {
  const { data, error } = await supabase.rpc('validate_classroom_join_code', { p_code: code })
  if (error) throw error
  return data?.[0] || null
}

export async function joinClassWithCode({ code, firstName, lastName, phone }) {
  const { data, error } = await supabase.rpc('join_classroom_with_code', {
    p_code: code,
    p_first_name: firstName,
    p_last_name: lastName,
    p_phone: phone,
  })
  if (error) throw error
  return data
}

/**
 * Public join when Auth signups are disabled: edge function creates/links the user,
 * enrolls them, and returns session tokens.
 */
export async function registerAndJoinClass({
  code,
  email,
  password,
  firstName,
  lastName,
  phone,
}) {
  const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const resp = await fetch(`${base}/functions/v1/classroom-join-student`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      code,
      email,
      password,
      first_name: firstName,
      last_name: lastName,
      phone,
    }),
  })

  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(payload.error || payload.details || 'Could not join class')
  }
  return payload
}

export async function linkTeacherByEmail(teacherId, email) {
  const { data, error } = await supabase.rpc('classroom_link_teacher', {
    p_teacher_id: teacherId,
    p_email: email,
  })
  if (error) throw error
  return data === true
}

export async function createClass(name, term) {
  const { data, error } = await supabase.rpc('classroom_create_class', {
    p_name: name,
    p_term: term || null,
  })
  if (error) throw error
  return data
}

export async function fetchSchools() {
  const { data, error } = await supabase
    .from('classroom_schools')
    .select('*')
    .order('name')
  if (error) throw error
  return data || []
}

export async function fetchTeachers() {
  const { data, error } = await supabase
    .from('classroom_teachers')
    .select('*, classroom_schools(name)')
    .order('last_name')
  if (error) throw error
  return data || []
}

export async function fetchAllClasses() {
  const { data, error } = await supabase
    .from('classroom_classes')
    .select('*, classroom_teachers(first_name, last_name, email, is_test), classroom_schools(name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/** Classes for a teacher. Pass teacherId when an exec is viewing a teacher's workspace. */
export async function fetchTeacherClasses(teacherId = null) {
  let query = supabase
    .from('classroom_classes')
    .select('*')
    .eq('archived', false)
    .order('created_at', { ascending: false })
  if (teacherId) query = query.eq('teacher_id', teacherId)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

/** True when the signed-in user is a SPAN exec (RLS-level admin for Classroom). */
export async function isSpanExec() {
  const { data, error } = await supabase.rpc('is_span_exec')
  if (error) return false
  return data === true
}

export async function fetchSpanMaterials({ includeInactive = false } = {}) {
  let query = supabase
    .from('classroom_span_materials')
    .select('*, classroom_span_material_targets(school_id, class_id)')
    .order('created_at', { ascending: false })
  if (!includeInactive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Exec: add a SPAN library item. Provide a file, a link, or both.
 * audience: 'all' | 'schools' (schoolIds) | 'classes' (classIds)
 */
export async function createSpanMaterial({
  title,
  description = '',
  file = null,
  linkUrl = '',
  audience = 'all',
  schoolIds = [],
  classIds = [],
}) {
  const cleanTitle = String(title || '').trim()
  if (!cleanTitle) throw new Error('Give the material a title.')
  const cleanLink = String(linkUrl || '').trim()
  if (cleanLink && !/^https?:\/\//i.test(cleanLink)) {
    throw new Error('Link must start with http:// or https://')
  }
  if (!file && !cleanLink) throw new Error('Attach a file or add a link.')
  if (file && file.size > MAX_SUBMISSION_BYTES) {
    throw new Error('File must be 10 MB or smaller')
  }
  if (audience === 'schools' && !schoolIds.length) throw new Error('Pick at least one school.')
  if (audience === 'classes' && !classIds.length) throw new Error('Pick at least one class.')
  if (!['all', 'schools', 'classes'].includes(audience)) throw new Error('Invalid audience.')

  const { data: userData } = await supabase.auth.getUser()
  let filePath = null
  let fileName = null
  if (file) {
    const path = `span-library/${Date.now()}_${Math.random().toString(36).slice(2, 8)}/${sanitizeFileName(file.name)}`
    const { error: uploadErr } = await supabase.storage.from(SUBMISSION_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    })
    if (uploadErr) throw uploadErr
    filePath = path
    fileName = file.name
  }

  const { data, error } = await supabase
    .from('classroom_span_materials')
    .insert({
      title: cleanTitle,
      description: String(description || '').trim() || null,
      file_path: filePath,
      file_name: fileName,
      link_url: cleanLink || null,
      audience,
      created_by: userData?.user?.id || null,
    })
    .select()
    .single()
  if (error) {
    if (filePath) await supabase.storage.from(SUBMISSION_BUCKET).remove([filePath])
    throw error
  }

  const targetRows =
    audience === 'schools'
      ? [...new Set(schoolIds)].map((school_id) => ({ material_id: data.material_id, school_id }))
      : audience === 'classes'
        ? [...new Set(classIds)].map((class_id) => ({ material_id: data.material_id, class_id }))
        : []
  if (targetRows.length) {
    const { error: targetErr } = await supabase.from('classroom_span_material_targets').insert(targetRows)
    if (targetErr) {
      // Roll back so a half-targeted item never goes live.
      await supabase.from('classroom_span_materials').delete().eq('material_id', data.material_id)
      if (filePath) await supabase.storage.from(SUBMISSION_BUCKET).remove([filePath])
      throw targetErr
    }
  }
  return data
}

/** Exec: soft-remove a SPAN library item (keeps the file for audit). */
export async function deactivateSpanMaterial(materialId) {
  const { error } = await supabase
    .from('classroom_span_materials')
    .update({ active: false })
    .eq('material_id', materialId)
  if (error) throw error
}

export async function fetchClassRoster(classId) {
  const { data, error } = await supabase
    .from('classroom_enrollments')
    .select('joined_at, classroom_students(student_id, first_name, last_name, email, phone)')
    .eq('class_id', classId)
    .order('joined_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchStudentEnrollments() {
  const { data, error } = await supabase
    .from('classroom_enrollments')
    .select('*, classroom_classes(*)')
    .order('joined_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchClassAssignments(classId) {
  const { data, error } = await supabase
    .from('classroom_assignments')
    .select('*, classroom_assignment_materials(material_id, file_path, file_name, created_at)')
    .eq('class_id', classId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchAssignmentSubmissions(assignmentIds) {
  if (!assignmentIds.length) return []
  const { data, error } = await supabase
    .from('classroom_submissions')
    .select('*, classroom_students(first_name, last_name)')
    .in('assignment_id', assignmentIds)
  if (error) throw error
  return data || []
}

export async function insertSchool(row) {
  const { data, error } = await supabase.from('classroom_schools').insert(row).select().single()
  if (error) throw error
  return data
}

/**
 * Load US public schools for a state from NCES CCD (via edge function).
 * @param {{ state: string, city?: string, q?: string }} params
 */
export async function fetchSchoolDirectory(params) {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) throw new Error('Supabase URL not configured')

  const state = String(params?.state || '').trim()
  if (!state) throw new Error('Select a state first')

  const cacheKey = `classroom_school_dir_v1:${state.toLowerCase()}`
  try {
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed?.schools && Array.isArray(parsed.schools) && parsed.at && Date.now() - parsed.at < 6 * 60 * 60 * 1000) {
        let schools = parsed.schools
        const cities = parsed.cities || []
        const city = String(params?.city || '').trim().toLowerCase()
        const q = String(params?.q || '').trim().toLowerCase()
        if (city) schools = schools.filter((s) => (s.city || '').toLowerCase() === city)
        if (q) schools = schools.filter((s) => s.name.toLowerCase().includes(q))
        return { ok: true, state: parsed.state, cities, schools, count: schools.length, cached: true }
      }
    }
  } catch {
    /* ignore cache errors */
  }

  const resp = await fetch(`${supabaseUrl}/functions/v1/classroom-school-directory`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ state }),
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(payload.error || payload.details || 'Failed to load school directory')
  }

  try {
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({
        at: Date.now(),
        state: payload.state,
        cities: payload.cities || [],
        schools: payload.schools || [],
      }),
    )
  } catch {
    /* quota / private mode */
  }

  let schools = Array.isArray(payload.schools) ? payload.schools : []
  const city = String(params?.city || '').trim().toLowerCase()
  const q = String(params?.q || '').trim().toLowerCase()
  if (city) schools = schools.filter((s) => (s.city || '').toLowerCase() === city)
  if (q) schools = schools.filter((s) => s.name.toLowerCase().includes(q))
  return { ...payload, schools, count: schools.length }
}

export async function insertTeacher(row) {
  const { data, error } = await supabase.from('classroom_teachers').insert(row).select().single()
  if (error) throw error
  return data
}

/** Soft-remove / restore a classroom school (does not wipe classes). */
export async function setSchoolActive(schoolId, active) {
  const { data, error } = await supabase
    .from('classroom_schools')
    .update({ active: !!active })
    .eq('school_id', schoolId)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Soft-remove / restore a classroom teacher.
 * Inactive teachers cannot use Classroom; classes remain for history.
 */
export async function setTeacherActive(teacherId, active) {
  const { data, error } = await supabase
    .from('classroom_teachers')
    .update({ active: !!active })
    .eq('teacher_id', teacherId)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Soft-remove a school and deactivate its teachers so logins and joins stop.
 * Prefer this over hard delete (CASCADE would wipe classes/enrollments).
 */
export async function deactivateSchool(schoolId) {
  const school = await setSchoolActive(schoolId, false)
  const { error } = await supabase
    .from('classroom_teachers')
    .update({ active: false })
    .eq('school_id', schoolId)
  if (error) throw error
  return school
}

async function classroomInviteAuthHeaders() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !session?.access_token) throw new Error('Not signed in')
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) throw new Error('Supabase URL not configured')
  return { supabaseUrl, anonKey, accessToken: session.access_token }
}

/** Mint classroom invite link. Pass schoolId to pin; omit for open invite (school dropdown on form). */
export async function createClassroomInviteLink({ schoolId = null, label = null } = {}) {
  const { supabaseUrl, anonKey, accessToken } = await classroomInviteAuthHeaders()
  const body = { action: 'create', kind: schoolId ? 'teacher' : 'school_and_teacher' }
  if (schoolId) body.school_id = schoolId
  if (label) body.label = label
  const resp = await fetch(`${supabaseUrl}/functions/v1/classroom-invites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify(body),
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const detail = [payload.error, payload.details].filter(Boolean).join(': ')
    throw new Error(detail || 'Failed to create classroom invite')
  }
  return payload
}

export async function listClassroomInvites() {
  const { supabaseUrl, anonKey, accessToken } = await classroomInviteAuthHeaders()
  const resp = await fetch(`${supabaseUrl}/functions/v1/classroom-invites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ action: 'list' }),
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(payload.error || payload.details || 'Failed to list classroom invites')
  }
  return Array.isArray(payload.invites) ? payload.invites : []
}

export async function revokeClassroomInvite(inviteId) {
  const { supabaseUrl, anonKey, accessToken } = await classroomInviteAuthHeaders()
  const resp = await fetch(`${supabaseUrl}/functions/v1/classroom-invites`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ action: 'revoke', invite_id: inviteId }),
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(payload.error || payload.details || 'Failed to revoke classroom invite')
  }
  return payload
}

export async function validateClassroomInvite(inviteToken) {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) throw new Error('Supabase URL not configured')
  const resp = await fetch(`${supabaseUrl}/functions/v1/classroom-invite-join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ action: 'validate', invite: inviteToken }),
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(payload.error || payload.details || 'Invalid invite')
  }
  return payload
}

export async function submitClassroomInviteJoin(payload) {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) throw new Error('Supabase URL not configured')
  const resp = await fetch(`${supabaseUrl}/functions/v1/classroom-invite-join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ action: 'submit', ...payload }),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(data.error || data.details || 'Failed to complete Classroom signup')
  }
  return data
}

export function localizeClassroomInviteUrl(joinUrl) {
  const raw = String(joinUrl || '').trim()
  if (!raw || typeof window === 'undefined') return raw
  try {
    const u = new URL(raw)
    u.protocol = window.location.protocol
    u.host = window.location.host
    return u.toString()
  } catch {
    return raw
  }
}

/** Exec: create auth user if needed, link teacher, email Classroom login. */
export async function provisionTeacher(teacherId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not signed in')

  const base = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const resp = await fetch(`${base}/functions/v1/classroom-provision-teacher`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ teacher_id: teacherId }),
  })

  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(payload.error || payload.details || 'Failed to provision teacher login')
  }
  return payload
}

export async function insertAssignment(row) {
  const { data, error } = await supabase.from('classroom_assignments').insert(row).select().single()
  if (error) throw error
  return data
}

export async function updateAssignment(assignmentId, patch) {
  const { data, error } = await supabase
    .from('classroom_assignments')
    .update(patch)
    .eq('assignment_id', assignmentId)
    .select('*, classroom_assignment_materials(material_id, file_path, file_name, created_at)')
    .single()
  if (error) throw error
  return data
}

export async function upsertSubmission(row) {
  const { data, error } = await supabase
    .from('classroom_submissions')
    .upsert(row, { onConflict: 'assignment_id,student_id' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function gradeSubmission(submissionId, grade, feedback) {
  const { data, error } = await supabase.rpc('classroom_grade_submission', {
    p_submission_id: submissionId,
    p_grade: grade ?? null,
    p_feedback: feedback ?? null,
  })
  if (error) throw error
  return data
}

function sanitizeFileName(name) {
  return String(name || 'file')
    .replace(/[^\w.\-()+ ]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120)
}

/** Upload a student submission file. Path: class/assignment/student/filename */
export async function uploadSubmissionFile({
  classId,
  assignmentId,
  studentId,
  file,
  allowFileUpload = true,
  allowedExtensions = null,
}) {
  const validationError = validateSubmissionFile(file, { allowFileUpload, allowedExtensions })
  if (validationError) throw new Error(validationError)

  const safeName = sanitizeFileName(file.name)
  const path = `${classId}/${assignmentId}/${studentId}/${Date.now()}_${safeName}`

  const { error } = await supabase.storage.from(SUBMISSION_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  })
  if (error) throw error

  return { path, fileName: file.name }
}

/** Teacher context files. Path: class/assignment/_materials/filename */
export async function uploadAssignmentMaterial({ classId, assignmentId, file }) {
  if (!file) throw new Error('No file selected')
  if (file.size > MAX_SUBMISSION_BYTES) {
    throw new Error('File must be 10 MB or smaller')
  }

  const safeName = sanitizeFileName(file.name)
  const path = `${classId}/${assignmentId}/_materials/${Date.now()}_${safeName}`

  const { error } = await supabase.storage.from(SUBMISSION_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  })
  if (error) throw error

  const { data, error: insertError } = await supabase
    .from('classroom_assignment_materials')
    .insert({
      assignment_id: assignmentId,
      file_path: path,
      file_name: file.name,
    })
    .select()
    .single()
  if (insertError) throw insertError
  return data
}

export async function deleteAssignmentMaterial(material) {
  if (!material?.material_id) return
  if (material.file_path) {
    await supabase.storage.from(SUBMISSION_BUCKET).remove([material.file_path])
  }
  const { error } = await supabase
    .from('classroom_assignment_materials')
    .delete()
    .eq('material_id', material.material_id)
  if (error) throw error
}

export async function getSubmissionFileUrl(filePath) {
  if (!filePath) return null
  const { data, error } = await supabase.storage
    .from(SUBMISSION_BUCKET)
    .createSignedUrl(filePath, 3600)
  if (error) throw error
  return data?.signedUrl || null
}

export async function removeSubmissionFile(filePath) {
  if (!filePath) return
  const { error } = await supabase.storage.from(SUBMISSION_BUCKET).remove([filePath])
  if (error) throw error
}

export async function updateClassFeatures(classId, features) {
  const { data, error } = await supabase
    .from('classroom_classes')
    .update({ features })
    .eq('class_id', classId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateStudentProfile(studentId, patch) {
  const { data, error } = await supabase
    .from('classroom_students')
    .update(patch)
    .eq('student_id', studentId)
    .select()
    .single()
  if (error) throw error
  return data
}
