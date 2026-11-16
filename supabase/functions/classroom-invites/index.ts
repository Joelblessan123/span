import { serve } from "https://deno.land/std@0.203.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const PRODUCTION_URL = (Deno.env.get("PRODUCTION_URL") ?? "https://spanationwide.org").replace(/\/$/, "")

const INVITE_TTL_DAYS = 30
const KINDS = new Set(["school_and_teacher", "teacher"])

function isExec(member: Record<string, unknown> | null): boolean {
  if (!member) return false
  const v = (x: unknown) => x === true || x === "true"
  return v(member.volunteer) && v(member.applications) && v(member.bills) && v(member.registration)
}

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("")
}

function joinUrlFor(token: string): string {
  return `${PRODUCTION_URL}/classroom/invite.html?invite=${encodeURIComponent(token)}`
}

function serializeInvite(row: Record<string, unknown>, schoolName?: string | null) {
  return {
    invite_id: row.invite_id,
    kind: row.kind,
    school_id: row.school_id ?? null,
    school_name: schoolName ?? null,
    label: row.label ?? null,
    created_at: row.created_at,
    expires_at: row.expires_at,
    use_count: row.use_count ?? 0,
    last_used_at: row.last_used_at ?? null,
    created_by: row.created_by ?? null,
    join_url: joinUrlFor(String(row.token ?? "")),
  }
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
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const body = (await req.json()) as {
      action?: string
      invite_id?: string
      kind?: string
      school_id?: string
      label?: string
    }
    const action = String(body.action ?? "create").trim().toLowerCase()

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const token = authHeader.replace("Bearer ", "")
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser(token)
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

    if (!isExec(callerMember)) {
      return new Response(JSON.stringify({ error: "Only executive directors can manage classroom invites" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const nowIso = new Date().toISOString()

    if (action === "list") {
      const { data: rows, error } = await admin
        .from("classroom_invites")
        .select(
          "invite_id, token, kind, school_id, label, created_at, expires_at, use_count, last_used_at, created_by, classroom_schools(name)",
        )
        .is("revoked_at", null)
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false })
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to list invites", details: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      const invites = (rows || []).map((r) => {
        const schoolRel = (r as { classroom_schools?: { name?: string } | null }).classroom_schools
        return serializeInvite(r as Record<string, unknown>, schoolRel?.name ?? null)
      })
      return new Response(JSON.stringify({ ok: true, action: "list", invites }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (action === "revoke") {
      const inviteId = String(body.invite_id ?? "").trim()
      if (!inviteId) {
        return new Response(JSON.stringify({ error: "invite_id is required to revoke a classroom invite" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      const { data: updated, error } = await admin
        .from("classroom_invites")
        .update({ revoked_at: nowIso })
        .eq("invite_id", inviteId)
        .is("revoked_at", null)
        .select("invite_id")
        .maybeSingle()
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to revoke invite", details: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      if (!updated) {
        return new Response(JSON.stringify({ error: "Invite not found or already revoked." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      return new Response(JSON.stringify({ ok: true, action: "revoke", invite_id: inviteId }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // create — open invite (teacher picks school from dropdown) or optionally pin to school_id.
    // Note: live DB may still have check classroom_invites_teacher_needs_school
    // (teacher ⇒ school_id NOT NULL). Open invites use kind=school_and_teacher until that
    // constraint is dropped (see classroom_invites_optional_school.sql).
    const schoolId = String(body.school_id ?? "").trim() || null
    const label = String(body.label ?? "").trim() || null

    let schoolName: string | null = null
    if (schoolId) {
      const { data: school, error: schoolErr } = await admin
        .from("classroom_schools")
        .select("school_id, name, active")
        .eq("school_id", schoolId)
        .maybeSingle()
      if (schoolErr || !school || school.active === false) {
        return new Response(JSON.stringify({ error: "Active school not found for pinned invite" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      schoolName = school.name
    }

    const kind = schoolId ? "teacher" : "school_and_teacher"
    if (!KINDS.has(kind)) {
      return new Response(JSON.stringify({ error: "Invalid invite kind" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const inviteToken = randomToken(24)
    const expires = new Date()
    expires.setDate(expires.getDate() + INVITE_TTL_DAYS)
    const { data: inserted, error: insErr } = await admin
      .from("classroom_invites")
      .insert({
        token: inviteToken,
        kind,
        school_id: schoolId,
        label: label || (schoolId ? schoolName : "Open teacher invite"),
        created_by: callerMember.member_id,
        expires_at: expires.toISOString(),
      })
      .select("*")
      .single()
    if (insErr || !inserted) {
      return new Response(JSON.stringify({ error: "Failed to create invite", details: insErr?.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    return new Response(
      JSON.stringify({
        ok: true,
        action: "create",
        ...serializeInvite(inserted as Record<string, unknown>, schoolName),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (err) {
    console.error("classroom-invites error", err)
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})
