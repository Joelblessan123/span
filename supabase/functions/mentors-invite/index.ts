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

    const body = (await req.json()) as { action?: string }
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
      return new Response(JSON.stringify({ error: "Only executive directors can manage mentor invites" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (action === "revoke") {
      const { error } = await admin
        .from("mentor_invites")
        .update({ revoked_at: new Date().toISOString() })
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
      if (error) {
        return new Response(JSON.stringify({ error: "Failed to revoke invites", details: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      return new Response(JSON.stringify({ ok: true, action: "revoke" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // create (or return existing non-expired invite)
    const nowIso = new Date().toISOString()
    const { data: existing } = await admin
      .from("mentor_invites")
      .select("*")
      .is("revoked_at", null)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    let invite = existing
    if (!invite) {
      const inviteToken = randomToken(24)
      const expires = new Date()
      expires.setDate(expires.getDate() + INVITE_TTL_DAYS)
      const { data: inserted, error: insErr } = await admin
        .from("mentor_invites")
        .insert({
          token: inviteToken,
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
      invite = inserted
    }

    const joinUrl = `${PRODUCTION_URL}/mentor-join.html?invite=${encodeURIComponent(invite.token)}`

    return new Response(
      JSON.stringify({
        ok: true,
        action: "create",
        invite_id: invite.invite_id,
        expires_at: invite.expires_at,
        join_url: joinUrl,
        use_count: invite.use_count ?? 0,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (err) {
    console.error("mentors-invite error", err)
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        details: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})
