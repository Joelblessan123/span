import { serve } from "https://deno.land/std@0.203.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

// Must be set as a Supabase secret (server-side), NOT VITE_LEGISCAN_API_KEY.
const LEGISCAN_API_KEY = Deno.env.get("LEGISCAN_API_KEY") ?? ""

const PERSON_CACHE_BUSTER = "v1"

function isExec(member: Record<string, unknown> | null): boolean {
  if (!member) return false
  const v = (x: unknown) => x === true || x === "true"
  return v(member.volunteer) && v(member.applications) && v(member.bills) && v(member.registration)
}

function hasBillsPermission(member: Record<string, unknown> | null): boolean {
  if (!member) return false
  const v = (x: unknown) => x === true || x === "true"
  return v(member.bills)
}

function canUseOutreachFeatures(
  member: Record<string, unknown> | null,
  isMentor = false,
): boolean {
  return isExec(member) || hasBillsPermission(member) || isMentor
}

function escapeContactString(s: unknown): string {
  return String(s ?? "").trim()
}

function extractContact(person: unknown): { email: string; phone: string; webmailUrl: string } {
  const p = (person && typeof person === "object" ? person : {}) as Record<string, unknown>
  const bio = (p.bio && typeof p.bio === "object" ? p.bio : {}) as Record<string, unknown>
  const bioSocial = (bio.social && typeof bio.social === "object" ? bio.social : {}) as Record<string, unknown>
  const emailRaw =
    p.email ||
    p.contact_email ||
    p.office_email ||
    p.work_email ||
    p.public_email ||
    bioSocial.email ||
    ""
  const phoneRaw =
    p.phone ||
    p.phone_number ||
    p.office_phone ||
    p.capitol_phone ||
    p.contact_phone ||
    bioSocial.capitol_phone ||
    bioSocial.district_phone ||
    bioSocial.phone ||
    ""
  const webmailRaw =
    p.webmail ||
    p.web_mail ||
    p.webmail_url ||
    p.web_mail_url ||
    p.contact_url ||
    p.contact_form_url ||
    p.contact_form ||
    bioSocial.webmail ||
    bioSocial.website ||
    ""

  const email = escapeContactString(emailRaw)
  const phone = escapeContactString(phoneRaw).replace(/\s+/g, " ")
  const webmailUrl = escapeContactString(webmailRaw)
  return { email, phone, webmailUrl }
}

function normalizeStateCode(state: unknown): string | null {
  const s = String(state ?? "").trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(s)) return s
  return null
}

function objectRows(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]
  if (v && typeof v === "object") {
    return Object.values(v as Record<string, unknown>).filter(
      (x) => x && typeof x === "object"
    ) as Record<string, unknown>[]
  }
  return []
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const body = await req.json() as { people_id?: string | number; op?: string; state?: string }
    const op = body?.op === "session_people" ? "session_people" : "get_person"

    if (!LEGISCAN_API_KEY) {
      return new Response(JSON.stringify({ error: "LEGISCAN_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Verify caller has bills access (bill team or exec)
    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const jwt = authHeader.replace("Bearer ", "")
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await userClient.auth.getUser(jwt)
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: callerMember } = await admin
      .from("members")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()

    let isMentor = false
    if (!callerMember) {
      const { data: mentorRow } = await admin
        .from("mentor_accounts")
        .select("mentor_account_id")
        .eq("user_id", user.id)
        .eq("active", true)
        .maybeSingle()
      isMentor = !!mentorRow
    }

    if (!canUseOutreachFeatures(callerMember, isMentor)) {
      return new Response(JSON.stringify({ error: "Bills permission required to fetch legislator contact info" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (op === "session_people") {
      const state = normalizeStateCode(body?.state)
      if (!state) {
        return new Response(JSON.stringify({ error: "state (2-letter code) is required for session_people" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const sessionsUrl = `https://api.legiscan.com/?key=${encodeURIComponent(
        LEGISCAN_API_KEY
      )}&op=getSessionList&state=${encodeURIComponent(state)}`
      const sessionsResp = await fetch(sessionsUrl)
      if (!sessionsResp.ok) {
        return new Response(JSON.stringify({ error: `LegiScan getSessionList failed: HTTP ${sessionsResp.status}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      const sessionsData = await sessionsResp.json()
      if (sessionsData?.status && sessionsData.status !== "OK") {
        return new Response(JSON.stringify({ error: `LegiScan getSessionList returned ${sessionsData.status}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      // LegiScan has used different keys/wrappers across API variants.
      const sessions = [
        ...objectRows(sessionsData?.sessions),
        ...objectRows(sessionsData?.sessionlist),
        ...objectRows(sessionsData?.data?.sessions),
        ...objectRows(sessionsData?.data?.sessionlist),
      ].filter((s) => s && (s.session_id != null || s.session_name != null || s.year_start != null))
      if (!sessions.length) {
        const keys = sessionsData && typeof sessionsData === "object" ? Object.keys(sessionsData).slice(0, 12) : []
        return new Response(JSON.stringify({ error: `No sessions returned for ${state}`, detail: { keys } }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      const sorted = [...sessions].sort((a, b) => {
        const aCurrent = Number(Boolean(a?.current))
        const bCurrent = Number(Boolean(b?.current))
        if (aCurrent !== bCurrent) return bCurrent - aCurrent
        const aYear = Number(a?.year_start || 0)
        const bYear = Number(b?.year_start || 0)
        if (aYear !== bYear) return bYear - aYear
        return Number(b?.session_id || 0) - Number(a?.session_id || 0)
      })

      // Some states expose "current" special/interim sessions with tiny rosters.
      // Merge people across several recent sessions to avoid false no-match outcomes.
      const sessionIds = sorted
        .map((s) => s?.session_id)
        .filter((id) => id != null)
        .slice(0, 6)

      if (!sessionIds.length) {
        return new Response(JSON.stringify({ ok: true, people: [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const peopleByKey = new Map<string, Record<string, unknown>>()
      for (const sessionId of sessionIds) {
        const peopleUrl = `https://api.legiscan.com/?key=${encodeURIComponent(
          LEGISCAN_API_KEY
        )}&op=getSessionPeople&id=${encodeURIComponent(String(sessionId))}`
        const peopleResp = await fetch(peopleUrl)
        if (!peopleResp.ok) continue
        const peopleData = await peopleResp.json()
        if (peopleData?.status && peopleData.status !== "OK") continue
        const people = [
          ...objectRows(peopleData?.sessionpeople),
          ...objectRows(peopleData?.people),
          ...objectRows(peopleData?.data?.sessionpeople),
          ...objectRows(peopleData?.data?.people),
        ]

        for (const p of people) {
          const row = (p && typeof p === "object" ? p : {}) as Record<string, unknown>
          const key =
            String(row.people_id ?? row.person_id ?? row.id ?? "").trim() ||
            String(row.name ?? "").trim().toLowerCase()
          if (!key) continue
          if (!peopleByKey.has(key)) peopleByKey.set(key, row)
        }
      }

      return new Response(JSON.stringify({ ok: true, people: [...peopleByKey.values()] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const people_id = body?.people_id
    if (!people_id) {
      return new Response(JSON.stringify({ error: "people_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Fetch person from LegiScan (server-side: no CORS).
    const url = `https://api.legiscan.com/?key=${encodeURIComponent(LEGISCAN_API_KEY)}&op=getPerson&id=${encodeURIComponent(
      String(people_id)
    )}&cachebust=${encodeURIComponent(PERSON_CACHE_BUSTER)}`

    const resp = await fetch(url)
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `LegiScan getPerson failed: HTTP ${resp.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const data = await resp.json()
    if (data?.status && data.status !== "OK") {
      return new Response(JSON.stringify({ error: `LegiScan getPerson returned ${data.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }
    const person =
      data?.person ||
      data?.data?.person ||
      data?.people ||
      data?.person_data ||
      data?.legislator ||
      data

    const contact = extractContact(person)

    return new Response(
      JSON.stringify({ ok: true, contact }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (err) {
    console.error("fetch-legiscan-person-contact error:", err)
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
}, { verifyJwt: false })

