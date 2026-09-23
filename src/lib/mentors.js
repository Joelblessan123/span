import { supabase } from './supabase'

export const MENTOR_EMAIL_DOMAIN = 'mentors.spanationwide.org'

export function mentorLoginEmailFromUsername(username) {
  const u = String(username || '')
    .trim()
    .toLowerCase()
    .replace(/@.*$/, '')
  if (!u) return ''
  return `${u}@${MENTOR_EMAIL_DOMAIN}`
}

/** Build a member-shaped object so existing bills/outreach UI keeps working. */
export function syntheticMemberFromMentorSession(session) {
  if (!session?.mentor_account_id) return null
  const parts = String(session.full_name || 'Mentor')
    .trim()
    .split(/\s+/)
  const first = parts[0] || 'Mentor'
  const last = parts.length > 1 ? parts.slice(1).join(' ') : ''
  return {
    member_id: null,
    _isMentor: true,
    mentor_account_id: session.mentor_account_id,
    advisor_id: session.advisor_id,
    first_name: first,
    last_name: last,
    preferred_name: session.full_name || null,
    email: session.login_email || session.email || null,
    username: session.username,
    title: session.title || null,
    company: session.company || null,
    image: session.photo || null,
    phone: session.phone || null,
    role: 'Board Mentor',
    active: true,
    registration_complete: true,
    volunteer: false,
    applications: false,
    bills: true,
    registration: false,
    blog: false,
  }
}

export async function getMentorSession() {
  const { data, error } = await supabase.rpc('get_mentor_session')
  if (error) throw error
  if (!data || typeof data !== 'object' || !data.mentor_account_id) return null
  return data
}

async function authHeaders() {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()
  if (sessionError || !session?.access_token) {
    throw new Error('Not signed in')
  }
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase URL not configured')
  }
  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    anonKey,
    accessToken: session.access_token,
  }
}

export async function provisionMentorLogin(advisorId, action = 'provision') {
  const { supabaseUrl, anonKey, accessToken } = await authHeaders()
  const resp = await fetch(`${supabaseUrl}/functions/v1/mentors-provision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ advisor_id: advisorId, action }),
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(payload.error || payload.details || 'Failed to provision mentor login')
  }
  return payload
}

/** Create or reuse an active mentor invite; returns join_url for execs to copy. */
export async function createMentorInviteLink() {
  const { supabaseUrl, anonKey, accessToken } = await authHeaders()
  const resp = await fetch(`${supabaseUrl}/functions/v1/mentors-invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ action: 'create' }),
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(payload.error || payload.details || 'Failed to create mentor invite')
  }
  return payload
}

export async function revokeMentorInvites() {
  const { supabaseUrl, anonKey, accessToken } = await authHeaders()
  const resp = await fetch(`${supabaseUrl}/functions/v1/mentors-invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ action: 'revoke' }),
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(payload.error || payload.details || 'Failed to revoke mentor invites')
  }
  return payload
}

export async function validateMentorInvite(inviteToken) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) throw new Error('Supabase URL not configured')
  const resp = await fetch(`${supabaseUrl}/functions/v1/mentors-join`, {
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

export async function submitMentorJoin(payload) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) throw new Error('Supabase URL not configured')
  const resp = await fetch(`${supabaseUrl}/functions/v1/mentors-join`, {
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
    throw new Error(data.error || data.details || 'Failed to submit mentor profile')
  }
  return data
}

export function fileToBase64Payload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const match = result.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) {
        reject(new Error('Could not read photo'))
        return
      }
      resolve({
        photo_base64: match[2],
        photo_content_type: match[1],
        photo_filename: file.name || 'photo.jpg',
      })
    }
    reader.onerror = () => reject(new Error('Could not read photo'))
    reader.readAsDataURL(file)
  })
}
