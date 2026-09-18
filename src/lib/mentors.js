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
    email: session.login_email,
    username: session.username,
    title: session.title || null,
    company: session.company || null,
    image: session.photo || null,
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

export async function provisionMentorLogin(advisorId, action = 'provision') {
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

  const resp = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/mentors-provision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
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
